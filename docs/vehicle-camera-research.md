# Vehicle camera research: GTA V and Baku

## What is documented

- Rockstar's GTA V vehicle controls distinguish **rotate camera**, **look behind**, **cycle camera modes**, and **brake/reverse when stopped**. Reverse and look-behind are separate controls; the manual does not establish that selecting reverse automatically flips the camera. Source: [GTA V Game Help, In Vehicle Controls](https://dlassets-ssl.xboxlive.com/public/content/4f0a3089-ba2c-4f3d-9e38-102a41cbd885/GameManual/bffef18e-3f19-4190-a9b1-75402359b13b/en-CA/index.html).
- GTA V lets players keep a different perspective in vehicles versus on foot. Source: [Rockstar Game Tips: Playing with Perspective](https://www.rockstargames.com/newswire/article/25o2411812oa29/rockstar-game-tips-playing-with-perspective-in-gtav).
- Rockstar documents camera preferences and first-person field-of-view options. The Rockstar sources consulted here do not specify the third-person vehicle rig's spring rates, high-speed distance/FOV curve, recenter timer, or reverse-camera algorithm. Source: [GTA V Game Help, First Person Camera](https://dlassets-ssl.xboxlive.com/public/content/4f0a3089-ba2c-4f3d-9e38-102a41cbd885/GameManual/bffef18e-3f19-4190-a9b1-75402359b13b/en-CA/index.html).

## Design approximation used here (not a claim about Rockstar's source code)

| Driving state | Baku camera response |
| --- | --- |
| Stopped | Medium-close follow rig; free 360° mouse orbit. The car stays near frame center. |
| Low forward speed | Free orbit below 25 km/h and soft spring following of vehicle position/yaw. |
| Higher forward speed | Look range blends down to about ±32° by 42 km/h; only after mouse inactivity does it recenter. The acceleration kick adds at most 1.55 m, then eases back as acceleration falls. |
| Reverse | Keep the camera referenced to the car's orientation, not travel velocity. No surprise 180° flip on selecting reverse; full manual orbit and hold-middle look-behind remain available. The aim point shifts slightly toward the rear of the car. |
| Menu / pause | Release pointer capture and show the cursor. Driving captures and hides it for uninterrupted orbit. |

This aims for the readable, car-centred feel of a third-person driving camera while preserving this game's requested low-speed full orbit and high-speed look limit. It is intentionally not represented as an exact GTA V recreation.
