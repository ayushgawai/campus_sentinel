"""Scripted 911 call for demo recordings, keyed to the clip clock.

Every line is spoken at its clip second (the wall's video time), so what
Sentinel says matches the picture: counts, weapons and people were checked
against the labelled frames (data/feeds/seville_scene_script.json). The
voice-over is added in editing; this drives the on-screen transcript.
"""

from __future__ import annotations

# (clip second, speaker, text)
DEMO_CALL: list[tuple[float, str, str]] = [
    (6, "dispatcher", "911, what's the address of your emergency?"),
    (9, "sentinel", "MacQuarrie Hall, San Jose State University, One Washington Square in San Jose. There are armed people in the ground-floor lobby."),
    (16, "dispatcher", "Okay. Who am I speaking with? Where are you calling from?"),
    (19, "sentinel", "This is Sentinel AI, the university's automated camera security system. I'm calling from the MacQuarrie Hall camera network."),
    (26, "dispatcher", "How many people do you see?"),
    (28, "sentinel", "Eight people in the lobby. Five of them are armed."),
    (34, "dispatcher", "What weapons do they have?"),
    (37, "sentinel", "Handguns and a knife. I count five handguns and one knife."),
    (44, "dispatcher", "Describe the people with weapons."),
    (47, "sentinel", "A man in a red polo shirt and jeans with a handgun. Two men in black T-shirts with handguns. A man in a white shirt with a handgun, and a man in a light-blue shirt with a knife."),
    (55, "dispatcher", "Is anyone hurt? Is anyone down?"),
    (57, "sentinel", "No one appears injured, and no one is down on camera. A man near the doors is now carrying a rifle."),
    (62, "sentinel", "Update: two of them just left the lobby and entered the east corridor on the ground floor, heading west."),
    (68, "dispatcher", "Describe the two in the corridor."),
    (71, "sentinel", "The closest is a man in a dark polo shirt and jeans with a handgun in his left hand. Ahead of him, a man in a white shirt with a knife."),
    (80, "dispatcher", "Which way are they going?"),
    (82, "sentinel", "West, down the east corridor, away from the lobby and toward the west wing and the stairwell."),
    (94, "dispatcher", "Any other weapons?"),
    (96, "sentinel", "Yes. Another man is carrying a rifle down by his side."),
    (106, "dispatcher", "Describe him."),
    (108, "sentinel", "A man in a black T-shirt and khaki trousers, rifle in his right hand, walking away from the camera."),
    (119, "sentinel", "Update: they've left the east corridor and entered the west corridor, near the stairwell."),
    (127, "dispatcher", "Are they going upstairs?"),
    (129, "sentinel", "No, they're staying on the ground floor. A man in a black T-shirt and jeans has a handgun, and the man ahead of him also has a handgun."),
    (145, "dispatcher", "Anything new?"),
    (148, "sentinel", "A man in a white T-shirt and blue shorts is carrying a rifle further down the west corridor."),
    (160, "dispatcher", "Officers are entering the building now. Where are they?"),
    (162, "sentinel", "Still in the west corridor near the stairwell, on the ground floor, walking away from the camera."),
    (173, "sentinel", "The west corridor camera is clear right now. They've stepped out of view near the stairwell."),
    (196, "sentinel", "They're back in view: a man in a black T-shirt and shorts with a handgun, and a man in a light-blue shirt holding a knife."),
    (206, "dispatcher", "Which way now?"),
    (208, "sentinel", "Back toward the east corridor. They're heading for the lobby."),
    (232, "sentinel", "Update: they've moved from the west corridor back into the east corridor, heading toward the lobby."),
    (244, "sentinel", "A man in a black T-shirt is holding up a handgun in the east corridor."),
    (252, "dispatcher", "Units are staging at the main entrance. How many are coming?"),
    (254, "sentinel", "Two people on this camera, one of them carrying a rifle."),
    (270, "sentinel", "Update: they're back in the ground-floor lobby, moving toward the main entrance."),
    (293, "dispatcher", "How many are in the lobby now?"),
    (295, "sentinel", "Three people with three handguns and a knife, and more are coming in through the doors."),
    (318, "dispatcher", "Describe the ones near the exit."),
    (320, "sentinel", "A man in a white T-shirt and blue denim shorts carrying a rifle, and a man in a black T-shirt with a handgun."),
    (330, "dispatcher", "Units are at the doors. Stay on the line."),
    (332, "sentinel", "Understood. I'll stay on the line and report every camera change."),
]
OPENING = 2  # lines always spoken first, even if the call starts late
