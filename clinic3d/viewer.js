// An offline renderer for the glTF subset produced by build_model.py.
(() => {
  "use strict";
  const byId = id => document.getElementById(id);
  const canvas = byId("model-canvas");
  const frame = byId("model-frame");
  const panel = byId("model-panel");
  const viewport = byId("clinic-view");
  const floorSelect = byId("model-floor");
  const up = new THREE.Vector3(0, 1, 0);
  const homeDirection = new THREE.Vector3(0.78, 0.90, 1.12).normalize();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.045, 750);
  const floorGroups = new Map();
  const floorBounds = new Map();
  const shellPositions = new Map();
  const selectedBounds = new THREE.Box3();
  const sun = new THREE.DirectionalLight(0xfff3dc, 2.3);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(350, 350), new THREE.ShadowMaterial({opacity: 0.20}));
  let renderer, controls, fleetScene, downloadUrl, pendingFrame = 0, initialized = false, available = false;
  let overview = true;

  function modelBytes() {
    const decoded = atob(byId("clinic-glb").textContent.trim());
    return Uint8Array.from(decoded, c => c.charCodeAt(0));
  }

  function readModel(bytes) {
    const data = new DataView(bytes.buffer);
    const jsonLength = data.getUint32(12, true);
    const gltf = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    const binary = 28 + jsonLength;
    const types = {5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array};
    const widths = {SCALAR: 1, VEC3: 3, VEC4: 4};
    function attribute(index) {
      const a = gltf.accessors[index], view = gltf.bufferViews[a.bufferView];
      const width = widths[a.type];
      const array = new types[a.componentType](bytes.buffer, binary + (view.byteOffset || 0) + (a.byteOffset || 0), a.count * width);
      return new THREE.BufferAttribute(array, width, !!a.normalized);
    }
    const geometries = gltf.meshes.map(mesh => {
      const primitive = mesh.primitives[0];
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", attribute(primitive.attributes.POSITION));
      geometry.setAttribute("normal", attribute(primitive.attributes.NORMAL));
      geometry.setAttribute("color", attribute(primitive.attributes.COLOR_0));
      geometry.setIndex(attribute(primitive.indices));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    });
    const material = new THREE.MeshStandardMaterial({vertexColors: true, roughness: 0.87, metalness: 0});
    for (const root of gltf.scenes[gltf.scene].nodes) {
      const floor = gltf.nodes[root], group = new THREE.Group();
      group.name = floor.name;
      group.position.fromArray(floor.translation);
      const placements = new Map();
      for (const index of floor.children) {
        const part = gltf.nodes[index], pose = new THREE.Object3D();
        if (part.translation) pose.position.fromArray(part.translation);
        if (part.rotation) pose.quaternion.fromArray(part.rotation);
        pose.updateMatrix();
        if (!placements.has(part.mesh)) placements.set(part.mesh, []);
        placements.get(part.mesh).push(pose.matrix);
      }
      for (const [index, poses] of placements) {
        const geometry = geometries[index];
        let object;
        if (poses.length === 1) {
          object = new THREE.Mesh(geometry, material);
          object.applyMatrix4(poses[0]);
        } else {
          object = new THREE.InstancedMesh(geometry, material, poses.length);
          poses.forEach((pose, instance) => object.setMatrixAt(instance, pose));
          object.instanceMatrix.needsUpdate = true;
          object.computeBoundingBox();
          object.computeBoundingSphere();
        }
        object.name = gltf.meshes[index].name;
        object.castShadow = true;
        object.receiveShadow = true;
        group.add(object);
      }
      scene.add(group);
      floorGroups.set(floor.name, group);
      floorBounds.set(floor.name, new THREE.Box3().setFromObject(group));
      const shell = gltf.nodes[floor.children[0]].mesh;
      shellPositions.set(floor.name, geometries[shell].getAttribute("position"));
    }
  }

  function render(now) {
    pendingFrame = 0;
    if (!available || panel.hidden || document.hidden) return;
    const moving = fleetScene?.paint(now);
    renderer.render(scene, camera);
    if (moving) schedule();
  }

  function schedule() {
    if (!pendingFrame && available && !panel.hidden && !document.hidden) pendingFrame = requestAnimationFrame(render);
  }

  function size() {
    if (!available || panel.hidden || !frame.clientWidth || !frame.clientHeight) return;
    renderer.setSize(frame.clientWidth, frame.clientHeight, false);
    camera.aspect = frame.clientWidth / frame.clientHeight;
    camera.updateProjectionMatrix();
    if (overview && !selectedBounds.isEmpty()) fit(camera.position.clone().sub(controls.target).normalize());
    schedule();
  }

  // Fit the actual walls and slab. The closest corner otherwise pushes a perspective cutaway off-center.
  function fit(direction) {
    const center = selectedBounds.getCenter(new THREE.Vector3());
    const right = new THREE.Vector3().crossVectors(up, direction).normalize();
    const viewUp = new THREE.Vector3().crossVectors(direction, right);
    const tanY = 0.88 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanX = tanY * camera.aspect;
    const point = new THREE.Vector3();
    let left = Infinity, rightmost = -Infinity, bottom = Infinity, top = -Infinity;
    for (const [name, group] of floorGroups) {
      if (!group.visible) continue;
      const positions = shellPositions.get(name);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).add(group.position).sub(center);
        const depth = point.dot(direction), x = point.dot(right), y = point.dot(viewUp);
        left = Math.min(left, x - depth * tanX);
        rightmost = Math.max(rightmost, x + depth * tanX);
        bottom = Math.min(bottom, y - depth * tanY);
        top = Math.max(top, y + depth * tanY);
      }
    }
    const distance = Math.max((rightmost-left)/(2*tanX), (top-bottom)/(2*tanY));
    const aim = center.clone().addScaledVector(right, (left+rightmost)/2).addScaledVector(viewUp, (bottom+top)/2);
    camera.position.copy(aim).addScaledVector(direction, distance);
    // Keep the orbit pivot at the floor center's height whenever the orbit is above the horizon.
    controls.target.copy(aim);
    if (direction.y > 0.20) controls.target.addScaledVector(direction, (center.y-aim.y)/direction.y);
    controls.maxDistance = Math.max(230, distance * 4);
    camera.far = controls.maxDistance + 160;
    camera.updateProjectionMatrix();
    controls.update();
    schedule();
  }

  function showFloors(reset = false, keepCamera = false) {
    if (!available) return;
    const direction = reset ? homeDirection : camera.position.clone().sub(controls.target).normalize();
    selectedBounds.makeEmpty();
    for (const [name, group] of floorGroups) {
      group.visible = floorSelect.value === "both" || floorSelect.value === name;
      if (group.visible) selectedBounds.union(floorBounds.get(name));
    }
    const center = selectedBounds.getCenter(new THREE.Vector3());
    sun.target.position.copy(center);
    sun.position.copy(center).add(new THREE.Vector3(-36, 73, 36));
    ground.position.set(center.x, selectedBounds.min.y - 0.025, center.z);
    if (renderer.shadowMap) renderer.shadowMap.needsUpdate = true;
    canvas.setAttribute("aria-label", "Interactive 3D clinic. " + floorSelect.selectedOptions[0].textContent +
      ". Drag to rotate, scroll or pinch to zoom, or use the keyboard.");
    fleetScene?.floorChanged();
    if (keepCamera) schedule();
    else { overview = true; fit(direction); }
  }

  function setUpLights() {
    scene.background = new THREE.Color(0xe4eae6);
    scene.add(new THREE.HemisphereLight(0xf6fcff, 0xb5ad97, 1.55));
    const fill = new THREE.DirectionalLight(0xd9eafa, 0.52);
    fill.position.set(30, 26, -40);
    scene.add(fill);
    sun.castShadow = true;
    Object.assign(sun.shadow.camera, {left: -49, right: 49, top: 49, bottom: -49, near: 1, far: 170});
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.00015;
    sun.shadow.normalBias = 0.025;
    scene.add(sun, sun.target);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  function message(text) {
    byId("model-message").textContent = text;
    byId("model-message").hidden = !text;
  }

  function initialize() {
    initialized = true;
    try {
      const bytes = modelBytes();
      downloadUrl = URL.createObjectURL(new Blob([bytes], {type: "model/gltf-binary"}));
      byId("model-download").href = downloadUrl;
      readModel(bytes);
      renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false, powerPreference: "high-performance"});
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      setUpLights();
      controls = new THREE.OrbitControls(camera, canvas);
      controls.minDistance = 0.85;
      controls.minPolarAngle = 0.025;
      controls.maxPolarAngle = Math.PI * 0.495;
      controls.rotateSpeed = 0.78;
      controls.panSpeed = 0.85;
      controls.zoomSpeed = 1.05;
      controls.screenSpacePanning = true;
      controls.zoomToCursor = true;
      controls.addEventListener("change", schedule);
      controls.addEventListener("start", () => { overview = false; });
      available = true;
      fleetScene = window.makeFleetScene({scene,camera,controls,canvas,frame,schedule,
        network:JSON.parse(byId("fleet-network").textContent),
        setFloor(name, keepCamera) { floorSelect.value = name; showFloors(false, keepCamera); },
        onFocus() { overview = false; }
      });
      size();
      showFloors(true);
      canvas.addEventListener("webglcontextlost", evt => {
        evt.preventDefault();
        message("The graphics context paused. Your model will return when the browser restores it.");
      });
      canvas.addEventListener("webglcontextrestored", () => {
        message(""); renderer.shadowMap.needsUpdate = true; size();
      });
    } catch (error) {
      console.warn("Clinic model initialization:", error);
      message("This browser could not display the 3D canvas. Open the GLB in a 3D viewer or enable browser graphics acceleration.");
    }
  }

  function zoom(factor) {
    if (!available) return;
    overview = false;
    const offset = camera.position.clone().sub(controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, controls.minDistance, controls.maxDistance);
    camera.position.copy(controls.target).add(offset.setLength(distance));
    controls.update();
    schedule();
  }

  function setExpandedText() {
    const expanded = document.fullscreenElement === viewport || viewport.classList.contains("expanded");
    byId("model-full").textContent = expanded ? "Exit full screen" : "Full screen";
    byId("model-full").setAttribute("aria-pressed", String(expanded));
    size();
  }

  async function toggleFullscreen() {
    if (viewport.classList.contains("expanded")) {
      viewport.classList.remove("expanded");
    } else if (document.fullscreenElement === viewport) {
      await document.exitFullscreen();
    } else {
      try { await viewport.requestFullscreen(); }
      catch { viewport.classList.add("expanded"); }
    }
    setExpandedText();
  }

  byId("model-full").addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", setExpandedText);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && viewport.classList.contains("expanded")) {
      viewport.classList.remove("expanded"); setExpandedText();
    }
  });
  byId("model-plus").addEventListener("click", () => zoom(0.8));
  byId("model-minus").addEventListener("click", () => zoom(1.25));
  function resetView() { fleetScene?.stopFollowing(); showFloors(true); }
  byId("model-reset").addEventListener("click", resetView);
  floorSelect.addEventListener("change", () => { fleetScene?.stopFollowing(); showFloors(); });
  canvas.addEventListener("keydown", event => {
    if (!available) return;
    const offset = camera.position.clone().sub(controls.target);
    const angles = new THREE.Spherical().setFromVector3(offset);
    switch (event.key) {
      case "ArrowLeft": angles.theta -= 0.13; break;
      case "ArrowRight": angles.theta += 0.13; break;
      case "ArrowUp": angles.phi -= 0.10; break;
      case "ArrowDown": angles.phi += 0.10; break;
      case "+": case "=": event.preventDefault(); zoom(0.8); return;
      case "-": event.preventDefault(); zoom(1.25); return;
      case "Home": event.preventDefault(); resetView(); return;
      default: return;
    }
    event.preventDefault();
    overview = false;
    angles.phi = THREE.MathUtils.clamp(angles.phi, controls.minPolarAngle, controls.maxPolarAngle);
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(angles));
    controls.update();
    schedule();
  });
  new ResizeObserver(size).observe(frame);
  window.addEventListener("clinic3d:visibility", event => {
    fleetScene?.visibility(event.detail);
    if (event.detail && !initialized) initialize(); else if (event.detail) size();
  });
  document.addEventListener("visibilitychange", () => {
    fleetScene?.visibility(!document.hidden && !panel.hidden);
    if (!document.hidden) schedule();
  });
  window.addEventListener("pagehide", event => {
    if (downloadUrl && !event.persisted) URL.revokeObjectURL(downloadUrl);
  });
})();
