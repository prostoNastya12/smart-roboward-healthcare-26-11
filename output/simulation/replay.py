"""Replay the fictional Smart RoboWard events using Python 3.9+ and its standard library."""

import argparse
import hashlib
import json
import os
import tempfile
from collections import defaultdict
from copy import deepcopy
from pathlib import Path


def decide_trip(event, state, required_fields, count, limit, lift_updated_at):
    """Return a decision for this request using only the current hospital state."""
    robot = event["robot_id"]
    payload = event["payload"]
    dispatch = state["pharmacy_dispatch"]
    requester = state["requester"]
    permit = state["demo_permit"]
    now = event["t_s"]

    if state["device_registry"].get(robot) != "active":
        return "deny", "robot_revoked" if state["device_registry"].get(robot) == "revoked" else "unknown_robot"
    if set(payload) - required_fields:
        return "deny", "extra_payload_field"
    if set(payload) != required_fields:
        return "deny", "missing_payload_field"
    if dispatch is None or dispatch["task_id"] != payload["task_id"]:
        return "deny", "no_dispatch"
    if dispatch["robot_id"] != robot:
        return "deny", "robot_mismatch"
    if payload["destination"] != dispatch["destination"]:
        return "deny", "destination_mismatch"
    if event["requested_dropoff_floor"] != dispatch["dropoff_floor"]:
        return "deny", "floor_mismatch"
    if event["requester_id"] != requester["id"] or requester["id"] != dispatch["requester_id"]:
        return "deny", "requester_mismatch"
    if requester["role"] != "pharmacy_dispatch" or dispatch["destination"] not in requester["allowed_destinations"]:
        return "deny", "requester_ward_not_allowed"
    if not permit or not permit["verified"] or permit["id"] != event["permit_id"]:
        return "deny", "permit_unverified"
    if any(permit[key] != dispatch[key] for key in ("task_id", "destination", "robot_id")):
        return "deny", "permit_mismatch"
    if now < permit["valid_from_s"]:
        return "deny", "permit_not_yet_valid"
    if now >= permit["expires_at_s"]:
        return "deny", "permit_expired"
    if permit["used_at_s"] is not None:
        return "deny", "permit_used"
    if count > limit:
        return "deny", "rate_limit"
    if state["urgent_transfer_active"]:
        return "hold", "urgent_transfer_active"
    if not state["route_clear"]:
        return "hold", "route_obstructed"
    if state["lift_status"] != "ready":
        return "hold", "lift_unavailable"
    if lift_updated_at is None or now - lift_updated_at > 10:
        return "hold", "stale_lift_update"
    return "allow", "authorized"


SOURCES = {
    "parcel_loaded": "pharmacy_scanner", "lift_state": "facilities_lift_sensor",
    "obstacle_present": "mock_robot_sensor", "route_verified_clear": "facilities",
    "device_revoked": "hospital_registry", "urgent_transfer_requested": "physical_priority_button",
    "urgent_transfer_finished": "facilities", "robot_lift_request": "hospital_gateway",
    "porter_handoff_offered": "logistics", "porter_handoff_accepted": "porter_scanner",
    "parcel_arrived": "ward_dock", "receipt_scan": "ward_scanner",
}


def simulate(initial_state, events, rules, lift_id, suppress_robot=False):
    state = deepcopy(initial_state)
    dispatch = state["pharmacy_dispatch"]
    destination = dispatch["destination"] if dispatch else None
    required_fields = set(rules["allowed_business_payload_fields"])
    rate = rules["rate_limit"]
    history = defaultdict(list)
    if state["demo_permit"]:
        history[state["demo_permit"]["robot_id"]] = list(state["prior_robot_request_times_s"])
    decisions, outputs, timeline = [], [], []
    receipt_ids, granted_robots, served_calls = set(), set(), set()
    call_waits, active_calls = {}, set()
    parcel = loaded_robot = offered_porter = accepted_porter = arrival = completed_by = None
    holder = state["parcel_holder"]
    handoffs = 0
    lift_update = None
    previous_time = -1

    for e in events:
        now, kind = e["t_s"], e["type"]
        if now < previous_time or kind not in SOURCES:
            raise ValueError(f"Out-of-order time or unknown event: {now} {kind}")
        previous_time = now
        if suppress_robot and kind == "robot_lift_request":
            continue
        action = "No state change"
        if e["source"] != SOURCES[kind] or e.get("lift_id", lift_id) != lift_id:
            action = "Ignored input from a different source or lift"
        elif kind == "parcel_loaded" and parcel is None:
            parcel, holder = e["parcel_id"], e["robot_id"]
            loaded_robot = holder
            action = "Pharmacy loaded the parcel"
        elif kind == "device_revoked":
            state["device_registry"][e["robot_id"]] = "revoked"
            action = "Hospital revoked the robot's permission"
        elif kind == "lift_state":
            state["lift_status"], lift_update = e["state"], now
            action = "Lift reported " + e["state"]
        elif kind in ("obstacle_present", "route_verified_clear"):
            state["route_clear"] = kind == "route_verified_clear"
            action = "Facilities cleared the route" if state["route_clear"] else "Sensor reported an obstacle"
        elif kind == "urgent_transfer_requested" and e["call_id"] not in call_waits:
            active_calls.add(e["call_id"])
            state["urgent_transfer_active"] = True
            # This model acknowledges a physical priority button in the same event tick.
            ack = {"t_s": now, "channel": "lift", "type": "priority_accepted", "call_id": e["call_id"]}
            outputs.append(ack)
            call_waits[e["call_id"]] = ack["t_s"] - e["t_s"]
            action = "Lift accepted the urgent patient call"
        elif kind == "urgent_transfer_finished" and e["call_id"] in active_calls:
            active_calls.remove(e["call_id"])
            served_calls.add(e["call_id"])
            state["urgent_transfer_active"] = bool(active_calls)
            action = "Facilities confirmed the urgent transfer finished"
        elif kind == "robot_lift_request":
            robot = e["robot_id"]
            history[robot].append(now)
            count = sum(now - rate["window_s"] < t <= now for t in history[robot])
            decision, reason = decide_trip(e, state, required_fields, count, rate["max_robot_requests"], lift_update)
            reply = {"request_id": e["request_id"], "decision": decision, "reason": reason}
            decisions.append(reply)
            outputs.append({"t_s": now, "channel": "robot", **reply})
            if decision == "allow":
                state["demo_permit"]["used_at_s"] = now
                granted_robots.add(robot)
                outputs.append({"t_s": now, "channel": "lift", "type": "grant",
                                "task_id": dispatch["task_id"], "destination": destination,
                                "floor": dispatch["dropoff_floor"]})
            action = f"{decision.upper()} robot trip ({reason.replace('_', ' ')})"
        elif kind == "porter_handoff_offered" and e["parcel_id"] == parcel and holder == loaded_robot:
            offered_porter = e["porter_id"]
            action = "Handoff offered. The robot still holds the parcel"
        elif (kind == "porter_handoff_accepted" and holder == loaded_robot and completed_by is None
              and e["parcel_id"] == parcel and offered_porter is not None and e["porter_id"] == offered_porter):
            holder = accepted_porter = offered_porter
            offered_porter = arrival = None
            handoffs += 1
            action = "Porter accepted custody"
        elif kind == "parcel_arrived" and e["parcel_id"] == parcel and e["destination"] == destination:
            if e["carrier"] == holder and (holder in granted_robots or holder == accepted_porter):
                arrival = holder
                action = "Parcel arrived. Awaiting the ward scan"
        elif kind == "receipt_scan" and e["parcel_id"] == parcel and e["destination"] == destination:
            if e["receipt_id"] in receipt_ids:
                action = "Duplicate ward receipt ignored"
            elif arrival is not None and arrival == holder and completed_by is None:
                receipt_ids.add(e["receipt_id"])
                completed_by = "porter" if holder == accepted_porter else "robot"
                holder = destination
                offered_porter = None
                action = "Ward scan closed the delivery"
        row = {"t_s": now, "event": kind, "action": action, "parcel_holder": holder}
        timeline.append(row)
        outputs.append({"channel": "routine_log", **row})

    observed = {
        "robot_decisions": decisions,
        "robot_lift_grants": sum(o.get("type") == "grant" and o["channel"] == "lift" for o in outputs),
        "urgent_calls_served": len(served_calls),
        "robot_caused_urgent_delay_s": None,
        "accepted_porter_handoffs": handoffs,
        "distinct_ward_receipts": len(receipt_ids),
        "final_parcel_holder": holder,
        "completed_by": completed_by,
        "private_marker_appearances_in_downstream_outputs": json.dumps(outputs).count(rules["private_test_marker"]),
    }
    return observed, timeline, outputs, call_waits


def run_case(case, rules, lift):
    inputs = (case["initial_state"], case["events"], rules, lift)
    observed, timeline, outputs, waits = simulate(*inputs)
    if waits:
        *_, baseline_waits = simulate(*inputs, suppress_robot=True)
        if waits.keys() == baseline_waits.keys():
            observed["robot_caused_urgent_delay_s"] = max(w - baseline_waits[k] for k, w in waits.items())
    expected = case["expected"]
    return {
        "case_id": case["case_id"], "title": case["title"], "cohort": case["cohort"],
        "observed": observed,
        "matches_expected": observed == expected,
        "differences": {k: {"expected": expected.get(k), "observed": observed.get(k)}
                        for k in sorted(expected.keys() | observed.keys()) if expected.get(k) != observed.get(k)},
        "timeline": timeline, "downstream_outputs": outputs,
    }


def summarize(cases):
    authorized = [c["observed"] for c in cases if c["cohort"] == "authorized_delivery"]
    unauthorized = [c["observed"] for c in cases if c["cohort"] == "unauthorized_request"]
    blocked = sum(bool(o["robot_decisions"]) and all(d["decision"] == "deny" for d in o["robot_decisions"])
                  and o["robot_lift_grants"] == 0 and o["private_marker_appearances_in_downstream_outputs"] == 0
                  for o in unauthorized)
    completed = sum(o["completed_by"] == "robot" and o["robot_lift_grants"] == 1
                    and o["distinct_ward_receipts"] == 1 for o in authorized)
    return {"unauthorized_stopped": blocked, "unauthorized_tested": len(unauthorized),
            "legitimate_completed": completed, "legitimate_tested": len(authorized),
            "matching_cases": sum(c["matches_expected"] for c in cases), "cases": len(cases),
            "events": sum(len(c["timeline"]) for c in cases)}


def save_report(path, report):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
        tmp = Path(handle.name)
    try:
        tmp.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=Path(__file__).with_name("smart-roboward-scenarios.json"))
    parser.add_argument("--case", metavar="ID", help="Display one case's timeline after running the suite")
    parser.add_argument("--results", type=Path, help="Write all observations and outgoing messages to a JSON file")
    args = parser.parse_args()
    if args.results and args.results.resolve() in {args.data.resolve(), Path(__file__).resolve()}:
        parser.error("Choose a separate output file for the results.")
    inputs = args.data.read_bytes()
    data = json.loads(inputs)
    if data["format_version"] != 1:
        parser.error("This runner reads version 1 scenario files.")
    cases = [run_case(c, data["replay"], data["demo_world"]["shared_lift_id"]) for c in data["scenarios"]]
    summary = summarize(cases)
    if args.case:
        selected = next((c for c in cases if c["case_id"] == args.case.upper()), None)
        if selected is None:
            parser.error(f"Unknown case {args.case}")
        print(f"{selected['case_id']} | {selected['title']}")
        for e in selected["timeline"]:
            print(f"{e['t_s']:4}s  {e['action']:<55}  Parcel: {e['parcel_holder']}")
    print("Unauthorized cases stopped: {unauthorized_stopped}/{unauthorized_tested}\n"
          "Legitimate deliveries completed: {legitimate_completed}/{legitimate_tested}\n"
          "Cases matching expected outcomes: {matching_cases}/{cases} ({events} input events)".format(**summary))
    if args.results:
        save_report(args.results, {
            "scope": "Offline reference policy replay. Arrival and transfer-finished times are scripted. "
                     "Priority calls are acknowledged in the same tick. Device identity, permit verification, "
                     "scanners and lift sensors are simulated. No robot, lift, or 3D engine is connected.",
            "input_sha256": hashlib.sha256(inputs).hexdigest(), "summary": summary, "cases": cases,
        })
    return int(summary["matching_cases"] != summary["cases"])


if __name__ == "__main__":
    raise SystemExit(main())
