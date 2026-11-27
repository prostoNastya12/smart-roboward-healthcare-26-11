# C09 design cards

The planning cards retain their original wording and IDs. The [simulation results](../output/simulation/simulation-results.json) record the later software runs.

## Design guide

### C09-A01 · Guide

Smart RoboWard · C09

Adapted from the Design Council’s Double Diamond. Discover and Develop open up options. Define and Deliver narrow them. Read each pair of notes, then move down. All tests await a simulated run.

### C09-A02 · Practice

Four design principles

Start with the people waiting for a delivery. Draw the handover using words and symbols. Invite staff to redraw it. Revise one unclear step and try it again.

### C09-A03 · Guide

Choose a method

In the Design Council methods bank, explore a need with the journey map, shape an option through role-play, and build a test plan from the resulting scenarios.

### C09-A04 · Invitation

Who can change the brief?

Ask a sponsor to make room for experiments. Invite pharmacy, nursing, facilities and logistics to challenge the sketches. Record whose perspective is missing and reopen the brief when evidence changes.

## Discover

### C09-D01 · Evidence

What IFOHRA asks

The C09 organizer brief asks for a practical way to protect patient information, secure connected robots and use data responsibly in a clinical workflow. It leaves the team a choice of workflow.

### C09-D02 · Evidence

A lift shared with the ward

At kickoff (26 Nov, 01:08:54–01:09:56), the speaker pictured a pharmacy robot heading to the nursing station. Staff and patients also depend on the lift. This was an example in the pitch.

### C09-D03 · Evidence

The team’s lift proposal

In the 27 Nov 09:47 session (03:56, 07:23–08:24), the team discussed synthetic lift data, floor-specific robot permissions and human review for an exception. The team had yet to choose its focus.

### C09-D04 · Question

Who waits during a hold?

When a robot cannot continue, how do the pharmacy sender and the receiving nurse find out? Ask each role whom they would contact and who would look after the parcel meanwhile.

### C09-D05 · Method

User journey mapping

Map dispatch, lift request, arrival and receipt from the ward’s perspective. Mark where the nurse first knows who has the parcel. Circle the first gap and ask the team to verify it.

### C09-D06 · Method

User diary

Ask two people playing staff roles to log one simulated trip each. At each pause, note what they saw, what they expected and what they did next. Compare their accounts.

### C09-D07 · Method

Service safari

Walk the mock route as the receiving nurse. Try finding the handover point using the signs on the table. Sketch one cue that helped and one that left you guessing.

### C09-D08 · Method

User shadowing

With their agreement, follow a teammate acting as a porter through a paused delivery. Record what they actually do and when they seek help. Ask why afterwards.

## Define

### C09-F01 · Method

User personas

Draft provisional profiles for the receiving nurse and the lift coordinator. Give each a goal, a decision they can take and an unanswered question. Check the profiles with people in those roles.

### C09-F02 · Method

Brainstorming

Ask everyone for two ways to keep the ward informed when a trip pauses. Group the ideas by the need they address. Pick one that a nursing representative wants to explore.

### C09-F03 · Method

Design brief

Draft one sentence naming the user, the handover problem, the simulated setting and the evidence needed to judge success. Ask a ward representative and the mentor which assumption to check first.

### C09-F04 · Hypothesis

A problem worth testing

A receiving nurse may lose sight of the parcel when a robot pauses at the lift. Would naming the responsible role and the next action let the nurse follow the handover?

### C09-F05 · Question

Which fields does each role need?

Sketch separate robot, lift and ward views. Ask which decisions need a fictional trip ID, a floor pair, a status or a receipt. Remove any field the role cannot justify.

### C09-F06 · Question

Who may review an exception?

Ask who can review a floor request and who can accept the parcel if no reviewer is available. Mark both roles as open until a workflow owner confirms them.

### C09-F07 · Choice

Choose a first workflow

Compare a floor-permission exception with a routine lift closure. For each, note whose work is interrupted, the privacy question and the smallest convincing simulation.

### C09-F08 · Decision pending

Agree the scope

Before building, record the chosen workflow, the reason, the person deciding and one remaining uncertainty. If nobody can evidence the need, return to Discover with that question.

## Develop

### C09-V01 · Method

Service blueprint

Draw four lanes for ward, porter, robot and lift. Align each visible message with the person or system behind it. Mark where responsibility changes hands during a hold.

### C09-V02 · Method

Experience prototyping

Use paper floor cards, a parcel token and a mock alert. Play the same pause twice with different alert wording. Ask the receiver who has the parcel and what they would do next.

### C09-V03 · Method

Business model canvas

Sketch the nine blocks. Start with wards served, value of a traceable handover, training and support costs. Mark the budget owner, funding and partner commitments as assumptions to check.

### C09-V04 · Concept

Permission for one trip

Model a fictional robot permitted to serve one floor. A different floor pauses that robot’s request and alerts the reviewer. Ask how the reviewer would communicate a one-trip decision.

### C09-V05 · Concept

A person takes the handover

Keep the parcel assigned to its current holder until a staff role accepts it. Show the role and acceptance time to the ward. Ask whether staff can distinguish an offer from an accepted handover.

### C09-V06 · Experiment

Compare two explanations

Show “Trip paused” to one role-player. Show another the reason, the parcel holder and the next contact. Ask both the same two questions about custody and next action. Keep their answers for review.

### C09-V07 · Constraint

Keep the lift available to others

Give the robot and a fictional staff traveller separate requests. Keep a robot hold local to its trip so the staff journey can continue. Model the lift using invented states and floor labels.

### C09-V08 · Decision pending

Pick the next prototype

Compare the two sketches on care continuity, data exposure and staff effort. Record the biggest trade-off and whose observation would change the choice. Carry that question into testing.

## Deliver

### C09-L01 · Method

Design scenarios

Draw three endings for the same fictional delivery. The usual floor is allowed, another floor needs review, or the lift is unavailable. In each ending, ask the ward to identify who holds the parcel.

### C09-L02 · Test planned

Routine delivery

Give the simulated robot a valid floor permission and an available lift. Expect one ward receipt for the trip. Save the event sequence, expected outcome and actual receipt count.

### C09-L03 · Test planned

A floor outside permission

Request a fictional floor outside the trip permission. Expect the robot to wait and the designated reviewer to see the reason. Count any onward movements while review is pending. Target zero.

### C09-L04 · Test planned

Unavailable lift

Mark the mock lift unavailable. Expect a staff handover offer and a visible wait until someone accepts it. Record the accepting role and check that no false delivery receipt appears.

### C09-L05 · Test planned

Check who sees what

Use a fictional marker in the test input. Inspect the robot view, lift message and routine log. Expect zero appearances of the marker. Save the field names and actual count for each view.

### C09-L06 · Feedback

Ask for a teach-back

After the pause, ask a fresh reviewer, “Who has the parcel, and what happens next?” Capture their answer before explaining the screen. Record a confusing word and retest a revision.

### C09-L07 · Evidence to collect

Keep a test record

For each run record the scenario, expected result, observed result and evidence reference. Mark pass, fail or unrun. The pitch can then distinguish a demonstrated outcome from an open question.

### C09-L08 · Decision pending

Decide what the pitch can claim

Review the results with a workflow representative. Record what to demonstrate, revise or drop and who owns the next test. Revisit the brief if the results point to a different problem.
Using this canvas

Start with one problem. Follow the short IDs to a requirement and then a What if…? card. Each requirement includes a suggested check. W01–W08 revisit unrun cases, W09–W14 prompt tabletop decisions, and W15–W16 invite alternative designs.
Sources

S1  IFOHRA challenge brief
S2  Kickoff, 26 Nov · 01:08:54–01:10:27
S3  C09 discussion, 27 Nov · 09:47 session
S4  Ward Relay team proposal
S5  Ward Relay evaluation plan · F01–F08

## Discovery questions

### C09-P01 · Discovery question

Who sees the delivery details?

The robot needs a destination. Sending the whole pharmacy order could reveal a patient’s name or medication in a lift message or a routine log.

#Privacy

Requirements R01 R03 R11 R23 R24
Sources S1 S4 S5

### C09-P02 · Discovery question

Is this trip authorized?

A known robot could request a floor outside its assigned route. Who can verify that it has permission for this particular trip?

#Prevention #AccessControl

Requirements R02 R05 R06 R15 R26
Sources S1 S2 S3

### C09-P03 · Discovery question

Who can explain an exception?

The hospital may need to establish who approved an exception and why. What should it record, who may read it, and when should it erase it?

#Identification #Privacy #AccessControl

Requirements R03 R05 R11 R25
Sources S1 S2 S4

### C09-P04 · Discovery question

Can staff use this mid-shift?

If checking one delivery takes several screens and calls, staff may lose time. How much work would the proposed handover add on a busy shift?

#Usability

Requirements R04 R14
Sources S1 S4

### C09-P05 · Kickoff example

Two journeys need one lift

In the kickoff example, a pharmacy robot and an urgent patient transfer to theatre need the same lift. Who decides which journey waits and tells the ward?

#Continuity

Requirements R05 R07 R13 R27
Sources S2

### C09-P06 · Discovery question

Who has the parcel at shift change?

A porter may receive a handover request before taking the parcel. If the shift changes in between, how will the next coordinator know who actually has it?

#Continuity

Requirements R08 R10 R14 R18
Sources S4 S5

### C09-P07 · Discovery question

Can staff trust the last lift update?

A second fleet may use a different status label, or the latest lift update may be old. In either case, the coordinator could mistakenly conclude that the lift is ready.

#Identification

Requirements R09 R12 R19 R28
Sources S3 S4 S5

### C09-P08 · Discovery question

One parcel, two receipts?

A repeated delivery message could create two receipts. A message claiming delivery while handover is still pending could close the trip before the ward confirms receipt.

#Identification #Continuity

Requirements R10
Sources S4 S5

### C09-P09 · Team discussion

How far does the simulated disruption reach?

The team considered external, internal and environmental disruptions. In the simulation, how could staff tell whether one robot, the shared lift or several trips are affected?

#Identification #Continuity

Requirements R02 R07 R13 R16 R17
Sources S3

### C09-P10 · Discovery question

Who acts when a trip is on hold?

The coordinator may miss a hold or be unable to reach the person who can review it. How will the ward learn why the parcel is waiting and who can take the next step?

#Continuity #Usability

Requirements R04 R08 R14
Sources S3 S4 S5

### C09-P11 · Team scope

Can a retired robot still ask for the lift?

A robot leaves service, but a delivery request arrives under its old identity. Who owns that connection, and how would staff know its access ended when the robot retired?

#Prevention #AccessControl

Requirements R15
Sources S6

### C09-P12 · Team scope

Who spots access that already happened?

A lift request was accepted, but the ward has no matching dispatch. How would staff distinguish a missing record from unauthorized access and decide which connection to hold?

#Identification

Requirements R16 R17
Sources S6

### C09-P13 · Team scope

Can the ward receive a parcel while access is in doubt?

Access may still be active. The ward needs its parcel, and another service may share the affected connection. Who can confirm a usable alternative and take responsibility for the delivery?

#Continuity #Identification

Requirements R17 R18 R20
Sources S6

### C09-P14 · Team scope

Which part of the service can return in seconds?

A replacement service can start while access or parcel ownership is still uncertain. How quickly could a person accept the delivery, and what evidence would allow the first automated trip?

#Continuity #Recovery

Requirements R18 R19 R20 R21 R30
Sources S6

### C09-P15 · Team scope

What should happen when a camera sees someone on the floor?

A delivery robot rounds a corner and a small figure lies in its path. How can it hold position and alert nearby staff even if it cannot tell who or what it sees? Who actually needs an image?

#Camera #Privacy #Continuity

Requirements R22 R23 R25
Sources S9 S1

### C09-P16 · Team scope

Could the details still point to one person?

A blurred frame or coded alert still carries the room and exact time. Could someone reasonably identify the person from a shift roster, another record or the code key?

#Privacy #AccessControl #Anonymisation #Pseudonymisation

Requirements R23 R24 R25
Sources S9 S10

### C09-P17 · Team scope

Who may change a robot remotely?

A supplier asks to service one robot during the night shift. Who can approve the named engineer, limit what they can change and end access while work is still open?

#AccessControl #Maintenance

Requirements R26 R27
Sources S9

### C09-P18 · Team scope

Will a new version work with the ward’s equipment?

The release notes name the application, but an indirect dependency has changed. Who can check what will actually be installed and whether the robot and lift simulator still agree on a trip?

#Dependencies #Maintenance

Requirements R28 R30
Sources S9 S11

### C09-P19 · Team scope

Which package did the hospital approve?

Two packages carry the same release label in the repository. How can the installer identify the reviewed file, who published it and who approved moving it into the release repository?

#Artifacts #AccessControl

Requirements R27 R29 R30
Sources S9 S11 S12

## Requirements

### C09-R01 · Organizer brief

Keep patient details private

The brief requires patient information to stay private. In a trial, put fictional patient and medicine names in a dispatch and check that neither appears in robot, lift or routine audit views or exports.

#Privacy

Problems P01
Scenarios W08 W12 W16 W26 W28
Sources S1 S5

### C09-R02 · Organizer brief

Protect connected systems

The brief calls for protecting connected systems against cyber threats. As one proposed check, give a simulated trip no route permission and verify that it receives zero onward approvals.

#Prevention #AccessControl

Problems P02 P09
Scenarios W05 W13
Sources S1 S5

### C09-R03 · Organizer brief

Use information responsibly

The brief requires safe, responsible use of data. In a trial, trace one delivery to verify that pharmacy alone keeps the link to the order and that each shared field serves a named task.

#Privacy

Problems P01 P03
Scenarios W08 W12 W29
Sources S1 S4

### C09-R04 · Organizer brief

Make the idea practical for staff

The brief asks for a simple, practical idea. On one simulated hold, ask a coordinator to identify the reason, current owner and next action on one screen without coaching.

#Usability

Problems P04 P10
Scenarios W14 W15 W16
Sources S1 S4 S5

### C09-R05 · Kickoff requirement

Keep the hospital in control

The kickoff calls for hospital control over access, logistics and information. In a replay, have the clinic role set who may use the route, which trip takes priority and which fields leave pharmacy, then verify all three decisions.

#Prevention #Continuity #Privacy #AccessControl

Problems P02 P03 P05
Scenarios W05 W09 W10 W12 W13
Sources S2 S4

### C09-R06 · Team proposal

Check each trip’s permission

Check the robot, role and route for each trip. In a trial, remove one permission and verify that the trip stays on hold and only the designated reviewer can decide the exception.

#Prevention #AccessControl

Problems P02
Scenarios W01 W05 W17
Sources S3 S4 S5

### C09-R07 · Team proposal

Keep an urgent lift route available

Apply hospital priority rules and hold only the delivery leg that needs the lift. In a replay, give an urgent transfer priority and verify that it can use the available lift while the tote waits.

#Continuity

Problems P05 P09
Scenarios W09
Sources S2 S4

### C09-R08 · Team proposal

Record who accepted custody

Keep the current owner until the porter explicitly accepts the tote. Delay acceptance in the replay, verify that ownership changes once, and close the delivery only when the ward confirms receipt.

#Continuity

Problems P06 P10
Scenarios W01 W02 W03 W04 W05 W06 W07 W10 W14 W16 W20 W22
Sources S4 S5

### C09-R09 · Team proposal

Compare the meaning and age of updates

Use timestamps and a common meaning for status from each supplier. Trial two equivalent fresh updates and expect the same decision, then check that a stale or unknown status holds the next leg.

#Identification #Continuity

Problems P07
Scenarios W02 W04 W11
Sources S3 S4 S5

### C09-R10 · Team proposal

Handle repeated or conflicting events

Count a repeated event once and send conflicting accounts for review. Replay a duplicate receipt, then supply incompatible custody updates. Expect one receipt and a visible unresolved conflict.

#Identification #Continuity

Problems P06 P08
Scenarios W06 W11 W22
Sources S4 S5

### C09-R11 · Team proposal

Limit what each role and log retain

Define the fields each role needs, a minimal audit record and who sets retention. Compare one synthetic trip’s outputs with the field lists and confirm that the hospital has named a retention owner.

#Privacy #AccessControl

Problems P01 P03
Scenarios W08 W12 W15 W28 W29 W30
Sources S4 S5

### C09-R12 · Prototype constraint

Use independently written test inputs

The team reported that it lacked permission to reuse a supplier’s lift documentation. For this prototype, trace each mock input to an independently authored synthetic fixture and mark supplier compatibility as unverified.

#Prototype

Problems P07
Scenarios W08 W11
Sources S3 S4

### C09-R13 · Team proposal

Identify the impact and preserve continuity

Show which tasks depend on an unavailable asset. In an offline simulation, withhold one lift update, hold its dependent leg and verify that a separate task with no dependency still finishes.

#Identification #Continuity

Problems P05 P09
Scenarios W09 W13 W19
Sources S3 S4

### C09-R14 · Team proposal

Make the hold clear across shifts

Show the reason, owner and fallback in text that works without colour. In a shift handover with the reviewer absent, ask incoming staff to find the designated backup and verify that the hold remains until an authorized decision.

#Continuity #Usability

Problems P04 P06 P10
Scenarios W03 W04 W07 W10 W11 W13 W14 W15
Sources S3 S4

### C09-R15 · Team proposal

Give each connection an owner and an end date

Register the robot, permitted route, expiry and hospital owner. Replace or revoke its test credential when its assignment ends. Verify that the retired identity gets zero new lift approvals and the approved replacement gets one.

#Prevention #AccessControl

Problems P02 P11
Scenarios W17
Sources S6 S7

### C09-R16 · Team proposal

Check an alert against an independent record

Give the reviewer the synthetic request, time, route and outcome. Compare them with an independent dispatch record. Record whether unauthorized access is confirmed, ruled out or still unresolved, with the evidence and reviewer.

#Identification

Problems P09 P12
Scenarios W18 W19 W21 W24
Sources S6 S7 S8

### C09-R17 · Team proposal

Block the affected robot connection

In the exercise, the hospital’s incident lead suspends robot requests on the named connection. Check that the block took effect and show its scope to the ward. Facilities retains control of the lift and emergency priority.

#Identification #Continuity #AccessControl

Problems P09 P12 P13
Scenarios W18 W19 W20 W24
Sources S6 S8

### C09-R18 · Team proposal

Keep custody during a manual delivery

While unauthorized access persists or remains uncertain, use a hospital-approved manual route with independently verified dependencies. Check who accepts the parcel, who confirms receipt at the ward and which automated link stays on hold.

#Continuity

Problems P06 P13 P14
Scenarios W20 W21 W23
Sources S6 S7 S8

### C09-R19 · Team proposal

Verify the recovery copy before a trial trip

Compare rollback with a clean replacement. Verify the source, access settings and whether the old version reintroduces a known flaw. Reconcile open trips with an independent receipt. Incident and facilities leads review the evidence before a limited trial.

#Recovery #Prevention #Maintenance #Artifacts

Problems P07 P14
Scenarios W21 W22 W23 W24 W25 W36
Sources S6 S8

### C09-R20 · Team proposal

Time the fallback and the authorized return

Start both clocks at the simulated incident declaration. Record seconds to the first accepted manual handoff and to the first authorized automated trip completed. Test any seconds target against the agreed milestone. Keep the route held if a safety check fails.

#Continuity #Recovery

Problems P13 P14
Scenarios W23 W24 W25
Sources S6 S8

### C09-R21 · Team proposal

Establish which resilience obligations apply

Identify the product, manufacturer, market and intended use. Ask procurement to record why the CRA applies, is excluded or needs review. Request recovery evidence for the supplied version and name who will assess it.

#Recovery #CRA

Problems P14
Scenarios W25
Sources S6 S7

### C09-R22 · Team proposal

Hold movement and alert trained staff

In the simulation, a low obstacle, a possible person or an uncertain view triggers a stop or hold. Send the location to trained ward staff. Keep the route held until staff verify it is clear and authorize release. The alert needs no identity or saved image.

#Camera #Continuity

Problems P15
Scenarios W26 W27
Sources S9

### C09-R23 · Team proposal

Keep raw camera frames out of routine records

For the demo, process synthetic frames locally and discard them after detection. Inspect alerts, thumbnails, diagnostics and exports before and after masking. Routine outputs should carry only the hazard, location and time needed by staff.

#Privacy #Camera

Problems P01 P15 P16
Scenarios W26 W27 W28 W30
Sources S9 S10

### C09-R24 · Team proposal

Distinguish anonymisation from pseudonymisation

Treat relinkable codes as personal data and keep the linking key separate with restricted access. Before calling an output anonymous, assess whether anyone could reasonably identify a person from the remaining details and other available information.

#Privacy #AccessControl #Anonymisation #Pseudonymisation

Problems P01 P16
Scenarios W29
Sources S9 S10

### C09-R25 · Team proposal

Limit access to a justified incident clip

Use a staged clip for an exceptional review. Record the purpose, approving role and deletion date. Check that only the designated reviewer can view the minimum excerpt until expiry, that export needs separate approval and that the access is logged.

#AccessControl #Privacy #Camera

Problems P03 P15 P16
Scenarios W30
Sources S9 S10

### C09-R26 · Team proposal

Limit each supplier maintenance session

Require hospital approval for a named engineer, multi-factor authentication, a single target, necessary privileges and an end time. On the simulator, revoke an active session and verify the next change is denied. Log who approved, acted and closed it.

#AccessControl #Maintenance #Prevention

Problems P02 P17
Scenarios W31
Sources S9

### C09-R27 · Team proposal

Agree who can authorize an installation

Record the target, change owner, approved window, ward contact, package and fallback. Name separate publisher, approver and installer roles. In a mock change, verify who can postpone it when care takes priority and who tells the ward.

#AccessControl #Maintenance #Continuity

Problems P05 P17 P19
Scenarios W31 W34 W35 W36
Sources S9 S11 S12

### C09-R28 · Team proposal

Review direct and indirect dependencies

Compare the proposed release’s software bill of materials (SBOM) with the installed version. Review changed direct and transitive components, known issues and supported combinations. In a simulator, require an explicit result for compatibility with the robot and lift interface.

#Dependencies #Maintenance

Problems P07 P18
Scenarios W32
Sources S9 S11

### C09-R29 · Team proposal

Promote and install the reviewed artifact

In the rehearsal, identify the approved repository, version and digest. Verify the release signature against the trusted signer. Separate rights to publish and promote in the repository, such as Artifactory. Confirm the installer can read the approved copy but cannot replace it.

#Artifacts #AccessControl #Prevention

Problems P19
Scenarios W32 W33 W34 W35
Sources S9 S11 S12

### C09-R30 · Team proposal

Test a limited release and a safe fallback

Rehearse on a simulator with an open delivery. Verify local safety checks and the custody receipt before one monitored trial. If it fails, keep the approved staffed route available and assess the earlier version’s integrity and known issues before authorizing rollback.

#Maintenance #Continuity #Recovery

Problems P14 P18 P19
Scenarios W32 W35 W36
Sources S9 S8 S11

## Scenarios and design explorations

### C09-W01 · Unrun case F01

What if the lift is ready for a permitted delivery?

Trace the simulated trip from pharmacy to ward. Look for the first robot reaching the lift, approval for transfer, the second robot completing its leg and exactly one ward receipt, in that order.

#Prevention #Continuity

Requirements R06 R08
Sources S2 S4 S5

### C09-W02 · Unrun case F02

What if two fleets describe the same state differently at exactly 10 seconds?

Translate both updates into a common status. Under the 10-second inclusive limit chosen for this simulation, look for the same decision as F01, one approval to continue and one ward receipt.

#Continuity

Requirements R08 R09
Sources S4 S5

### C09-W03 · Unrun case F03

What if the lift reports scheduled maintenance?

Pause the trip before the lift and show the coordinator why. Look for zero approvals to continue during the hold and one manual handoff receipt naming the trip, accepting role and time.

#Continuity #Maintenance

Requirements R08 R14
Sources S2 S4 S5

### C09-W04 · Unrun case F04

What if the last lift update is 11 seconds old?

Advance the simulated clock one second past the 10-second limit. Check that a hold precedes any approval to continue, that staff can see the reason and responsible role, and that one manual handoff receipt records acceptance.

#Identification #Continuity

Requirements R08 R09 R14
Sources S4 S5

### C09-W05 · Unrun case F05

What if the assigned role lacks permission for this route?

Show the coordinator which route permission is missing. Check for zero approvals to continue and one receipt when an authorized staff member accepts the manual handoff.

#Prevention #Continuity #AccessControl

Requirements R02 R05 R06 R08
Sources S3 S4 S5

### C09-W06 · Unrun case F06

What if one fleet reports both progress and delivery twice?

Replay both duplicates against the same simulated trip. Count one logical transfer, one final ward receipt and one trip in the totals.

#Continuity

Requirements R08 R10
Sources S4 S5

### C09-W07 · Unrun case F07

What if the lift is unavailable and staff take time to accept the handoff?

Keep the current holder visible while acceptance is pending, then record one accepted handoff to logistics. Check that there is no automatic release or false ‘delivered’ state before or after acknowledgement.

#Continuity

Requirements R08 R14
Sources S4 S5

### C09-W08 · Unrun case F08

What if fictional patient and medicine names enter the test trip?

Compare the robot, lift and routine audit views and exports with their allowed fields. Check that neither marker appears, every field is permitted for its recipient and the authorized ward still records exactly one receipt.

#Privacy

Requirements R01 R03 R11 R12
Sources S1 S4 S5

### C09-W09 · Tabletop question

What if staff need the shared lift for an urgent transfer?

Ask the shift coordinator which request takes priority in the simulation. Show the decision and the robot’s waiting state, then check that an independent, authorized trip can still proceed.

#Continuity

Requirements R05 R07 R13
Sources S2 S4

### C09-W10 · Tabletop question

What if the designated reviewer is unavailable at shift change?

Ask the incoming team to find the current custodian and the authorized backup. Check that the trip stays on hold until an authorized reviewer decides and the log identifies their role and decision.

#Prevention #Continuity #AccessControl

Requirements R05 R08 R14
Sources S4

### C09-W11 · Tabletop question

What if the robot reports arrival but the lift reports no robot present?

Use two contradictory synthetic status signals and ask who can resolve the discrepancy. Keep the trip on hold and record which evidence the reviewer accepted before allowing the next leg.

#Identification

Requirements R09 R10 R12 R14
Sources S3 S4

### C09-W12 · Tabletop question

What if someone asks to keep delivery records longer for a new use?

Ask the clinic’s information owner to decide whether the proposed purpose, recipient and deletion date are acceptable. Record the decision and check that the original sharing and retention limits hold until a change is approved.

#Privacy

Requirements R01 R03 R05 R11
Sources S1 S2 S4

### C09-W13 · Tabletop question

What if a wider disruption affects one route while another service still works?

Ask the responsible coordinator to review the evidence and decide which route to isolate. Show the unaffected service continuing, then record the reviewer’s decision and evidence before resuming the affected route.

#Identification #Continuity #Recovery

Requirements R02 R05 R13 R14
Sources S3 S4

### C09-W14 · Tabletop question

What if a first-time reviewer has to take over the demo?

Give them the normal trip and an interrupted trip to compare. Ask them to explain the difference, identify the custodian and resume the held trip through the authorized path, recording elapsed time and any help needed.

#Recovery #Usability

Requirements R04 R08 R14
Sources S1 S2 S3 S4

### C09-W15 · Design exploration

What if each ward could choose how to hear about a delay?

Sketch a call and a discreet on-screen alert for the same fictional hold. Ask a ward representative which they would notice mid-shift and which details the message needs.

#Privacy #Usability

Requirements R04 R11 R14
Sources S4

### C09-W16 · Design exploration

What if staff could see who holds the parcel when the screen is unavailable?

Try a paper handover slip marked only with a fictional trip ID. Ask a porter and a ward colleague to show who holds it now and how to reconcile acceptance with the later ward receipt.

#Continuity #Privacy

Requirements R01 R04 R08
Sources S4 S5

### C09-W17 · Incident tabletop

What if yesterday’s robot requests a trip after replacement?

Give the simulator a request from each fictional identity. Check that the retired robot receives zero new approvals and its replacement receives one only for its assigned route.

#Prevention #AccessControl

Requirements R06 R15
Sources S6

### C09-W18 · Incident tabletop

What if an accepted request has no matching dispatch?

Give staff two fictional records, one for the lift and one for pharmacy. Ask which evidence is missing, who can confirm the finding, and what should remain on hold during review.

#Identification

Requirements R16 R17
Sources S6 S8

### C09-W19 · Incident tabletop

What if unauthorized access is confirmed on one connection?

Have the incident lead mark that connection blocked in the simulation. Look for zero subsequent robot approvals on it, a ward notice identifying the affected trip, and a separate facilities decision on any independent lift use.

#Identification #Continuity #AccessControl

Requirements R13 R16 R17
Sources S6 S8

### C09-W20 · Incident tabletop

What if unauthorized access persists while the ward is waiting?

Keep the affected link suspended. Give a porter an independently checked route. Trace one accepted handoff and one ward receipt, then show which other service can continue under its own controls.

#Continuity

Requirements R08 R17 R18
Sources S6

### C09-W21 · Incident tabletop

What if the alerts stop and nobody can confirm the access ended?

The usual fallback shares the suspect connection. Ask the shift lead to verify a separate route or keep the parcel with its current holder. Record who will review the evidence before automation resumes.

#Identification #Continuity

Requirements R16 R18 R19
Sources S6 S8

### C09-W22 · Incident tabletop

What if the last backup predates a porter’s receipt?

The backup also contains an unfixed flaw. Ask the incident lead to choose a verified clean replacement, reconcile it with an independent custody record and check that the same parcel is never sent twice.

#Continuity #Recovery #Maintenance #Artifacts

Requirements R08 R10 R19
Sources S6 S8

### C09-W23 · Incident tabletop

What if the replacement starts in seconds but still awaits release?

Choose which recovery milestone the seconds target covers before starting. From the same incident declaration, time acceptance of the manual handoff and completion of the first authorized automated trip. Record waits for review.

#Continuity #Recovery

Requirements R18 R19 R20
Sources S6 S8

### C09-W24 · Incident tabletop

What if an alert returns during the first restored trip?

The hospital’s incident lead pauses the trial and blocks its connection again. Keep the last custody receipt and new alert. Ask the designated security and facilities reviewers what evidence would justify a second trial.

#Identification #Recovery

Requirements R16 R17 R19 R20
Sources S6 S8

### C09-W25 · Incident tabletop

What if a supplier promises recovery in seconds?

Ask which product, version and milestone the claim covers. Compare the supplier’s evidence with the two clocks on W23. Record what remains untested, who assesses CRA applicability and who can authorize a limited trial.

#Recovery #CRA

Requirements R19 R20 R21
Sources S6 S7 S8

### C09-W26 · Tabletop exercise

What if the camera sees a baby on the floor?

Use a baby-sized mannequin or a synthetic scene. Check that the robot stops before reaching it, alerts trained staff with the location and waits for clearance. Inspect the routine trace for zero saved images and zero identity guesses.

#Camera #Privacy #Continuity

Requirements R01 R22 R23
Sources S9

### C09-W27 · Tabletop exercise

What if glare makes the floor look clear?

Give the simulator an ambiguous frame. Check that the robot stays held, a trained staff member receives the location and the exercise records who verified the path. A missing detection alone cannot release the trip.

#Camera #Continuity

Requirements R22 R23
Sources S9

### C09-W28 · Tabletop exercise

What if the screen is masked but a support export contains a raw thumbnail?

Place a fictional marker in the synthetic frame. Trace the preview, diagnostics and export. Record where the marker survives and keep the export on hold until the unnecessary image is removed and the check passes.

#Camera #Privacy

Requirements R01 R11 R23
Sources S9 S10

### C09-W29 · Tabletop exercise

What if one room and time reveal who a coded alert concerns?

Give the reviewer an invented roster and alert. If the key or surrounding details identify someone, keep personal-data controls and record why. Test a coarser time or location before proposing an anonymous release.

#Privacy #AccessControl #Anonymisation #Pseudonymisation

Requirements R03 R11 R24
Sources S9 S10

### C09-W30 · Tabletop exercise

What if the incident reviewer needs one short clip?

Give the approved reviewer one staged excerpt. Confirm a porter cannot open it, the reviewer cannot export it without approval, and the excerpt is deleted on the agreed date. Check the access record for the role, reason and expiry.

#AccessControl #Privacy #Camera

Requirements R11 R23 R25
Sources S9 S10

### C09-W31 · Tabletop exercise

What if the supplier’s session expires halfway through maintenance?

Ask the engineer to request one further change in the simulation. Expect it to be denied. Check the session closure, the hospital owner of the unfinished work and the new approval needed to resume.

#AccessControl #Maintenance

Requirements R26 R27
Sources S9

### C09-W32 · Tabletop exercise

What if a signed release includes an incompatible indirect dependency?

Give reviewers a valid signature and a changed component in the SBOM. Run the simulated compatibility check. If it fails, hold promotion and record the component, affected interface and decision owner.

#Dependencies #Maintenance #Artifacts

Requirements R28 R29 R30
Sources S9 S11

### C09-W33 · Tabletop exercise

What if a familiar release label points to a different file?

Compare the candidate’s digest and signer with the signed approval record. If either differs, quarantine the candidate, withhold installation and record which approved artifact the ward is still using.

#Artifacts #Identification

Requirements R29
Sources S9 S11 S12

### C09-W34 · Tabletop exercise

What if the person who uploads a build also tries to approve its release?

In a fictional Artifactory workflow, give the publisher only the staging role. Verify that the candidate stays in staging until an independent approver records the reviewed digest and permits promotion.

#AccessControl #Artifacts

Requirements R27 R29
Sources S9 S11 S12

### C09-W35 · Tabletop exercise

What if the repository is unavailable or its contents cannot be trusted?

Present two fictional notices. For an outage, pause new installs and account for current deliveries. If integrity is in doubt, quarantine the candidate and record which independent release evidence is needed before anyone can approve it.

#Artifacts #Continuity #Recovery

Requirements R27 R29 R30
Sources S9 S11 S8

### C09-W36 · Tabletop exercise

What if the trial fails during an urgent transfer and the old version has a known flaw?

Keep the trial on hold and give the ward its approved staffed route. Ask who can preserve the last custody receipt, rule out the flawed rollback and authorize a verified replacement for a later simulator trial.

#Maintenance #Continuity #Recovery

Requirements R19 R27 R30
Sources S9 S8 S11
