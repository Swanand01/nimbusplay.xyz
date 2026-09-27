# Linux streaming test (Ubuntu + Sunshine on g4dn)

Date: 2026-09-27
Instance: `i-01ed6fe5150b5ff86` (g4dn.xlarge, on demand), Mumbai, in the existing VPC.
Nothing in the backend, Terraform or the Windows AMI was changed for this.

## Why

Windows costs ~$0.18/hour more per VM in licensing (g4dn.xlarge: $0.579 Linux vs ~$0.763
Windows), and Linux would open the door to containers. Apollo's author warned against it:
higher capture latency, worse capture performance, **more bandwidth on still images**, and
poor NVIDIA driver support. This test measures those claims on our own hardware.

## What was built

| Layer | Choice | Why |
|---|---|---|
| OS | Ubuntu 24.04.5 LTS | Best-supported target for these recipes |
| Display server | **X11** (Xorg 1.21.1), not Wayland | NVIDIA + wlroots is the fragile combination; the known T4 headless bug lived there |
| Desktop | XFCE with LightDM autologin (user `gamer`) | A session must exist for anything to capture |
| GPU driver | **AWS NVIDIA gaming driver 615.71.09** from `s3://nvidia-gaming/linux/latest/` | The plain Tesla driver exposes no display connectors; a T4 has no physical outputs |
| Virtual display | The gaming driver's virtual connector `DVI-D-0`, reported as **connected** | No dummy plug and no fake EDID needed, unlike every guide written for desktop GPUs |
| Capture | **NvFBC** (chosen automatically) | Lowest-overhead path; supported natively on the T4, and since Jan 2025 needs no driver patch |
| Encode | NVENC (H.264 + HEVC) | |
| Streaming | Sunshine 2026.914 (official .deb), as a user service | |
| Games | Steam + Proton, library on a separate 140 GB volume at `/games` | Mirrors the Windows D: drive |

Instance layout matches production: 50 GB root, separate 140 GB gp3 volume, same VPC and
subnet, streaming ports open to one IP via a temporary security group.

## Results

Measured with a sampler (`/usr/local/bin/stream-sampler`, 5s interval, CSV at
`/var/log/stream-samples.csv`): outbound Mbps, GPU %, encoder %, CPU %.

| State | Stream out | GPU | Encoder | CPU |
|---|---|---|---|---|
| In game (Brawlhalla, 720p) | **8.33 Mbps** avg (peak 9.6) | 21% | 9% | 53% |
| **Static screen, 3 min, untouched** | **3.98 Mbps, constant** | 1% | 8% | 5% |

- **The game ran under Proton with no fiddling**, and used the GPU (124 MB VRAM).
- **No dropped frames or encoder overload** in Sunshine's log.
- **CPU is the constraint, not the GPU.** A light 2D game left the T4 at 21% while the four
  vCPUs sat at 50-87%. If this route is taken, 8 vCPUs (g4dn.2xlarge) matters more than a
  bigger GPU.
- **Idle bandwidth confirms the warning.** A completely static screen still pushes 4 Mbps
  (~1.8 GB/hour, ~$0.20/hour). In-game is only twice that. The Windows licence saving is
  ~$0.18/hour, so idle streaming can cancel the entire reason for moving.
- Sunshine logs `Minimum FPS target set to ~30fps`, so it keeps encoding a floor of 30 fps
  even when nothing changes. That floor may be tunable — untested.

## Problems hit, and the fixes

1. **Nouveau blocks the driver install.** The installer blacklists it and aborts; reboot and
   re-run.
2. **`awscli` isn't in Ubuntu 24.04's default repos.** Use the official AWS CLI v2 installer.
3. **Sunshine's .deb filename** is `sunshine_<version>-1+ubuntu24.04_amd64.deb`, not the
   `sunshine-ubuntu-24.04-amd64.deb` pattern used elsewhere.
4. **Web UI refuses WAN clients** (`origin_web_ui_allowed`, LAN by default, same as Apollo),
   and newer Sunshine also rejects the request unless the URL is in `csrf_allowed_origins`.
5. **`Error -1` on connecting**: NvFBC fails with *"the display server is in modeset"* when
   the client resolution differs from the X screen and Sunshine changes mode mid-capture.
   Fix: make the X screen match the client resolution.
6. **720p wasn't an available mode.** The NVIDIA driver only offers EDID modes; add
   `Option "ModeValidation" "AllowNonEdidModes"` and `Option "metamodes" "1280x720 +0+0"`.
7. **Desktop in the corner, cursor offset**: the virtual screen was 1920x1080 while the mode
   was 1280x720, so capture covered a larger area than the desktop. Fix: `Virtual 1280 720`
   so framebuffer, mode and client all match.
8. **The game rendered on the CPU.** The NVIDIA installer skips its Vulkan driver when no
   Vulkan loader is installed yet, so Proton fell back to **lavapipe** (software Vulkan):
   GPU 7%, CPU 90%, game absent from the GPU process list. Fix: install `libvulkan1` first,
   then re-run the driver installer with `--install-compat32-libs`. **Install order matters.**
9. **Steam needed the library folder added by hand**, the mirror image of the Windows problem
   (there the path is registered but `steamapps` is missing; here the folders exist but
   Steam's config doesn't list them). An image would need to do both.
10. **No browser installed** with a minimal XFCE; `snap install firefox`.
11. **Double-click doesn't work well from a phone.** Set XFCE to single-click, or use a
    trackpad-mode client and a Bluetooth mouse.

## Still to do

- **Measure idle bandwidth on the Windows VM** as the control. Without it, the 4 Mbps figure
  has nothing to compare against.
- **Try lowering Sunshine's minimum FPS floor** and re-measure idle.
- **Client-side numbers** (decode time, host latency, drops) from Artemis's overlay, and a
  subjective comparison with the Windows VM.
- **A heavier game**, since Brawlhalla barely touches the GPU.

## Verdict so far

The stack works, and the display problem that worried us is solved cleanly by AWS's gaming
driver: no dummy plug, no fake EDID, NvFBC capture with no patching. The concerns that remain
are economic rather than technical: idle bandwidth eats the licence saving, and everything
here is ours to maintain, including a Sunshine build if we want Apollo's one-tap pairing
(~100 lines, portable, see `docs/specs`).

## Teardown

Delete when finished: instance `i-01ed6fe5150b5ff86`, volume `vol-0ba80a9af987bfd61`
(140 GB), security group `sg-08eebcd6b9bd87624`.
