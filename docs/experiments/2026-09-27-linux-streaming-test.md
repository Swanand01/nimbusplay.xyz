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
| Games | Steam + Proton, library at `/games` on a separate EBS volume (140 GB, later 200 GB) | Mirrors the Windows D: drive |

Instance layout matches production: 50 GB root, separate 140 GB gp3 volume, same VPC and
subnet, streaming ports open to one IP via a temporary security group.

## Results

Measured with a sampler (`/usr/local/bin/stream-sampler`, 5s interval, CSV at
`/var/log/stream-samples.csv`): outbound Mbps, GPU %, encoder %, CPU %.

| State | Stream out | GPU | Encoder | CPU |
|---|---|---|---|---|
| In game (Brawlhalla, 720p) | **8.33 Mbps** avg (peak 9.6) | 21% | 9% | 53% |
| **Static screen, 3 min, untouched** | **3.98 Mbps, constant** | 1% | 8% | 5% |
| eFootball, in a match, 720p | 8.8 Mbps avg | 35-42% | 5% | **96-97%, 0% idle** |

- **The game ran under Proton with no fiddling**, and used the GPU (124 MB VRAM).
- **No dropped frames or encoder overload** in Sunshine's log.
- **CPU is the constraint, not the GPU.** A light 2D game left the T4 at 21% while the four
  vCPUs sat at 50-87%. If this route is taken, 8 vCPUs (g4dn.2xlarge) matters more than a
  bigger GPU.
- **The same game is fine on Windows.** eFootball on the Windows AMI, same g4dn.xlarge and
  same 4 vCPUs, plays normally. Subjective rather than instrumented, but it is the control
  that matters: the hardware is not the problem, the stack is.
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
12. **NvFBC dies with "the display server is in modeset" after ~10 minutes idle**, and the
    client shows "connection terminated", error -1. The cause is `light-locker`, XFCE's
    default screen locker: it locks by asking LightDM for a greeter, and LightDM answers by
    starting a **second X server** on VT8. That server takes the DRM modeset, so NvFBC on
    `:0` can no longer create a capture session. LightDM's log shows
    `Seat seat0: Creating greeter session` at +606s and +2809s of two runs, each about two
    minutes before a failure. Restarting Sunshine never helps, because the greeter's X still
    holds the head; restarting LightDM does, because it kills both. Both servers run with
    `-novtswitch`, so the VT never switches back and the state stays stuck. Fix: disable
    light-locker's autostart, `xset s off -dpms`, and a `ServerFlags` section in `xorg.conf`
    setting `BlankTime`/`StandbyTime`/`SuspendTime`/`OffTime` to 0 so it survives a reboot.
13. **The Steam library was built on the instance store, not the EBS volume, and a stop/start
    wiped it.** A g4dn.xlarge exposes its 125 GB ephemeral NVMe alongside the EBS volumes, the
    kernel numbers them in no fixed order, and `/games` was formatted and labelled on the
    ephemeral one. Everything looked correct until the instance was stopped; the next boot
    logged `Timed out waiting for device /dev/disk/by-label/games` and the EBS volume turned
    out to have no filesystem at all — it had never been used. Roughly 60 GB of game installs
    were lost, though nothing else was: the driver, Sunshine and Steam itself live on the root
    volume. This is the same trap the Windows AMI already guards against. **Select the disk by
    its volume id, never by size or kernel order**: AWS puts the id in the NVMe serial, so
    `/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_vol<id>` resolves to the right device, and
    the instance store identifies itself as `Amazon EC2 NVMe Instance Storage`.
14. **A demanding game plays in slow motion on 4 vCPUs.** eFootball runs smoothly and at
    roughly half speed during a match; its menus and Brawlhalla are unaffected. All four
    vCPUs sit at 96-97% with 0% idle while the GPU is at 35-42% and drops no frames. The
    engine holds a fixed 60 fps simulation step, so starved of CPU it slows the match rather
    than dropping frames — and the stream still looks like smooth 60 fps, because NvFBC
    captures the desktop at 60 whatever the game drew. The client's fps counter therefore
    cannot detect this. Overhead beyond the game itself: **xfwm4 compositing took half a core
    and as much GPU as the game** (disabling it moved eFootball from 241% to 291% CPU and
    from 9-18% to 26-38% GPU — not enough to clear it), plus steamwebhelper, wineserver,
    Xorg and Sunshine. On top of that Proton runs eFootball's DX12 through vkd3d, CPU a
    Windows host never pays. Untested fix: 8 vCPUs (g4dn.2xlarge).

## Still to do

- **Measure idle bandwidth on the Windows VM** as the control. Without it, the 4 Mbps figure
  has nothing to compare against.
- **Try lowering Sunshine's minimum FPS floor** and re-measure idle.
- **Client-side numbers** (decode time, host latency, drops) from Artemis's overlay, and a
  subjective comparison with the Windows VM.
- **A heavier game**, since Brawlhalla barely touches the GPU.
- **g4dn.2xlarge (8 vCPU)** to see whether the slow motion clears, and at what hourly cost —
  only worth doing if the Linux route is revived.

## What the research says

- **NVIDIA's DX12-on-Linux penalty is the likely explanation, and it is unfixed.** NVIDIA's
  own developer forum carries a long-running report that DX12 games through vkd3d-proton lose
  **~18% fps without ray tracing and 30-50% with it**, while **AMD GPUs perform comparably to
  Windows**. The cause is CPU-side — draw-call overhead and CPU/GPU synchronisation inside the
  closed driver — and vkd3d's developers say they cannot work around it. No fix across driver
  versions 550 to 590+. vkd3d's own overhead is 1-5% on well-behaved titles, so this is
  specific to NVIDIA, not to Proton.
  <https://forums.developer.nvidia.com/t/directx12-performance-is-terrible-on-linux/303207>
- **The slow motion is Unreal's doing, not the stream's.** eFootball is built on a modified
  Unreal Engine 4, and UE's Smooth Frame Rate clamps delta time, so a starved game slows down
  instead of stuttering. PC players disable `bSmoothFrameRate` for exactly this. Every
  community fix for PES/eFootball slow motion is a frame-pacing one — CPU affinity, vsync mode
  — never a GPU upgrade, which matches GPU at 38% and CPU at 97%.
  <https://dev.epicgames.com/documentation/en-us/unreal-engine/smooth-frame-rate>
- **4 vCPUs is below what commercial services allocate.** GeForce NOW's Performance tier gives
  each session 8 vCPUs and 28 GB; Ultimate gives 16.
- **The locker problem is undocumented.** None of the headless Sunshine guides, including the
  widely cited Ubuntu 24.04 one, mention the screen locker or DPMS. Anyone following them on
  XFCE + LightDM gets a stream that dies after ten idle minutes with a misleading error.
- Worth trying if this route is revisited: Proton 9.0.4 rather than Experimental (ProtonDB's
  recommendation), shadows low, post-processing and ambient occlusion off, and
  `DXVK_FRAME_RATE=60`.

## Verdict so far

The stack works, and the display problem that worried us is solved cleanly by AWS's gaming
driver: no dummy plug, no fake EDID, NvFBC capture with no patching. The concerns that remain
are economic rather than technical: idle bandwidth eats the licence saving, and everything
here is ours to maintain, including a Sunshine build if we want Apollo's one-tap pairing
(~100 lines, portable, see `docs/specs`).

What came later undoes it. The desktop stack is not free: a screen locker silently broke
capture until it was disabled, and the compositor cost as much GPU as the game, so a Linux
image needs the desktop deliberately stripped rather than merely installed. More seriously,
eFootball plays in slow motion on 4 vCPUs here and plays fine on Windows on the same instance
type — and NVIDIA's unfixed DX12-on-Linux penalty explains why.

That closes the economic case. Making Linux work for a game like this means 8 vCPUs
(~$0.83/hour), which costs **more** than Windows on 4 vCPUs (~$0.763/hour). Both original
reasons for moving have gone: idle bandwidth eats the licence saving, and on NVIDIA you pay a
CPU tax on DX12 titles that Windows does not charge. Containers and control remain as reasons,
but they are no longer free ones. If the route is revived, AMD (g4ad) avoids the DX12 penalty
— at the cost of NVENC and NvFBC.

## Teardown

Delete when finished: instance `i-01ed6fe5150b5ff86`, volume `vol-0ba80a9af987bfd61`
(140 GB), security group `sg-08eebcd6b9bd87624`.
