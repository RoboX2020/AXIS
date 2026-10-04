# AeroPredict: Flight Path Prediction & Collision Avoidance Simulation

A real-time, interactive aviation simulation web platform modeling aircraft trajectories, **1090MHz ADS-B (DO-260B)** sensor telemetry feeds, and real-world collision avoidance algorithms (**TCAS II Version 7.1** and **FLARM**). 

The platform features an interactive 2D airspace tactical canvas, a real-time 3D spatial WebGL visualizer with multiple camera perspectives, live mathematical conflict calculations, a mock glass cockpit with TCAS Vertical Speed Indicator (VSI) and CDTI radar, and an interactive **Pilot Decision Prompter** that dynamically recalculates and re-routes flight paths during live simulations.

---

## 🌟 Key Features

### 1. Interactive 2D Airspace Tactical Canvas
- **Direct Aircraft Positioning**: Drag and drop Flight Alpha (Cyan) and Flight Bravo (Amber) anywhere on the 40 NM tactical radar grid.
- **Heading Vector Dials**: Interactive rotation handles allowing instantaneous heading changes (000° - 359°).
- **Dynamic Parameter Sliders**: Tune altitude (1,000 - 45,000 FT), ground speed (100 - 600 KTS), and vertical rate (-4,000 to +4,000 FPM).
- **Airspace Overlays**: Real-time rendering of the **12 NM Emergency Detection Range ring**, TCAS Tau warning rings, and velocity vectors.
- **Scenario Presets**: Instantly load pre-configured scenarios including Head-On Collision, 90° Cross Intercept, Same-Altitude Converge, Tail Chase, and Vertical Crossing.

### 2. AXIS 3D Trajectory Predictor & Algorithmic Pruning Scope
A self-contained, interactive 3D walkthrough of the pipeline AXIS runs when a TCAS **Traffic Advisory** (yellow alert) is issued. It is independent of the live two-aircraft simulation and is driven entirely from its own arguments panel.
- **Resizable layout**: 3D viewport (default 75% width) and arguments panel separated by a draggable divider (55–85%). Scroll to zoom, drag to orbit, with Behind / Side / Top camera presets.
- **① Diffusion-based maximum path generation**: from the aircraft nose, every node fans out `paths_per_hop` (2–10) strings on a spherical cap for `number_of_hops` (1–6) hops — `paths_per_hop ^ number_of_hops` paths in total. `turning_radius` opens the cap from a closed umbrella (wide radius) to a near-full hemisphere (tight radius). The wavefront appears hop by hop and "denoises" into place.
- **② LLM-based pruning**: each hop-to-hop segment is checked against the airframe envelope derived from `turning_radius`, `aircraft_age`, `aircraft_weight`, `max_climb_rate` and `max_load_factor` (turn per hop, climb, descent, course reversal, plus borderline "judgement" calls). Accepted segments turn **green**, rejected ones **red**, hop by hop at human speed; children of rejected segments inherit the rejection.
- **③ Exclude & consolidate**: *Exclude rejected paths* removes the red segments and k-means-merges the green paths into **10–20 yellow trajectories**.
- **④ Runtime NN pruning**: the *Run-time args* tab (`weight`, `age`, `engine_health`, `fuel_remaining`, `wind_shear`) feeds a small logistic classifier that ranks the yellow trajectories live and keeps the best **8–10**, highlighting the optimal one.
- The AI stages are deterministic, seeded simulations (no network calls) so the demo behaves identically every run. Very deep trees are sampled for rendering (≤ 8,000 segments per hop) while the theoretical path count is still reported.

### 3. High-Fidelity 3D Spatial Trajectory Visualizer (Three.js)
- **3D Jet Models**: Detailed dual-jet aircraft models with sweep wings, winglet tip strobes, engine nacelles, and colored afterburner trails.
- **Dual Trajectory Rendering**:
  - **Predicted Trajectory**: Rendered in bright, glowing dotted/dashed lines with 10-second waypoint time tick spheres and altitude drop pins.
  - **Executed / Decided Path**: Rendered as a solid grey trajectory line following user or pilot evasive maneuvers.
- **12 NM Emergency Prompt Boundary**: Luminous emergency ring and translucent cylindrical radar fence marking the 12 Nautical Mile detection envelope.
- **Closest Point of Approach (CPA) Marker**: 3D pulsating intercept beacon calculating spatial separation and time-to-CPA in real time.
- **Multi-Camera Directors**:
  - **Tactical Orbit**: Free 3D orbital camera with drag-to-rotate and wheel-zoom.
  - **Chase Alpha / Chase Bravo**: Dynamic third-person flight cameras tracking each jet's velocity vector.
  - **Cockpit Windscreen HUD**: First-person pilot perspective with aiming reticle, pitch ladder, and intruder target box.
  - **Intercept Cam**: High-angle perspective focusing directly on the projected conflict point.
  - **Top-Down Ortho**: Air Traffic Control radar style aerial view.

### 3. Conflict Detection Algorithms (TCAS II v7.1 & FLARM)
- **TCAS II Version 7.1 Compliance**:
  - Horizontal Tau ($\tau = -\frac{r}{\dot{r}}$) and Modified Tau ($\tau_{\text{mod}}$) with Distance Modification (DMOD = 1.10 NM).
  - Vertical Threshold ($Z_{\text{THR}} = 600\text{ FT}$) and Altitude Tau ($\tau_v$).
  - Dual-Level Alert Logic: **Traffic Advisory (TA)** at $\tau \le 40\text{s}$ and **Resolution Advisory (RA)** at $\tau \le 25\text{s}$.
  - Intelligent Sense Selection: Determines climb vs. descend sense by computing separation at CPA for each hypothesis.
- **FLARM Collision Prediction**:
  - Non-linear curved flight path extrapolation based on turn rate ($\omega = \frac{g \cdot \tan\phi}{V}$), bank angle, and acceleration vectors.
  - Multi-tier warning levels: Level 1 (Traffic within 18s), Level 2 (Conflict within 13s), Level 3 (Imminent collision within 8s).
- **12 NM Emergency Prompt Detection Envelope**: Prompts when closure rate indicates an unavoidable intercept inside 12 NM.

### 4. Interactive Pilot Decision Prompter & Vector Adjustment
- When an RA conflict or 12 NM emergency trigger occurs, the simulation prompts the user/pilot with selectable alternate evasion vectors:
  - **TCAS Climb Resolution**: Expedited climb at +2,500 FPM.
  - **TCAS Descend Resolution**: Expedited descent at -2,500 FPM.
  - **FLARM Tactical Lateral Turn**: 30° - 45° evasive turn right/left.
  - **Combined 3D Resolution**: Coordinated turn and vertical climb/descent.
- Once selected, the system executes an immediate **vector adjustment**, updates the 3D visualizer showing the active grey path, and recalculates safe CPA clearance.

### 5. Mock Cockpit Avionics Display
- **Cockpit Display of Traffic Information (CDTI)**: Modeled after Rockwell Collins / Honeywell TCAS displays with 360° compass rose, distance range rings (2 NM, 5 NM, 10 NM, 12 NM), intruder altitude differential tags, and vertical trend arrows.
- **TCAS Vertical Speed Indicator (VSI)**: Displays tape from -6,000 to +6,000 FPM with green "FLY TO" pitch command bands and red "AVOID" prohibition arcs.
- **Synthetic Cockpit Audio (Web Audio API)**: Authentic synthetic avionics alert tones ("TRAFFIC, TRAFFIC", "CLIMB, CLIMB", "DESCEND, DESCEND", "CLEAR OF CONFLICT").

### 6. SkyClash 3D: Multiplayer Flight Simulator Game (Host Screen & Mobile Phone Controller)
- **Multi-Screen QR Code Architecture**:
  - The Host Screen displays an interactive, live-generated **QR Code**.
  - Players scan the QR code with their mobile phone cameras to open the **Mobile Cockpit Flight Controller** on their phone browser without installing any app.
- **Master Screen 3D Camera Director**:
  - The Host Screen renders all active player planes and AI sparring aircraft in a shared 3D WebGL airspace with full spatial depth.
  - Directors: **Tactical Overview** (auto-framing the entire fleet), **ATC Tower Cam**, **Chase Leader Cam**, and **Satellite Map**.
  - Visuals include 3D jet hulls matching each player's team color, altitude drop pins, navigation strobes, flight trails, and 3D collision threat bubbles.
- **Flight Simulator Controls on Mobile Phones**:
  - Responsive touch-driven **Virtual Flight Stick (Pitch & Bank)** with natural flight mechanics (pull back to climb, push to dive, bank to turn).
  - Thrust throttle slider (0–100%), afterburner boost, and airbrake.
  - Dedicated **3D Cockpit/Chase View** rendered directly on the phone screen with HUD pitch ladder and airspeed/altitude readouts.
- **Flashing Clash Warnings & Pilot Suggestions on Phone**:
  - Powered by the real TCAS II & FLARM proximity detection algorithms.
  - Dedicated section on the mobile controller screen flashes when an intruder converges:
    - Amber Traffic Advisory (TA) vs. Flashing Red Critical Clash Warning (RA).
    - Displays intruder bearing, closing distance (NM), and time-to-impact (s).
    - **Contextual Flight Suggestion**: Direct suggestions on evasive maneuvers (e.g. `PULL UP / EXPEDITE CLIMB (+2,500 FPM)`, `HARD BREAK RIGHT (+45°)`, `PUSH DOWN / DIVE`).
    - **[Execute Suggestion]** Button: Instant auto-pilot evasive reflex assisting the pilot to avoid collision.
- **Server-Authoritative Real-Time Architecture**:
  - Built with Express and Node.js WebSockets running a 25Hz server-authoritative physics loop for low-latency synchronization across devices.

### 7. Real-Time ADS-B Telemetry Stream (DO-260B)
- Live generated **1090MHz Mode S Extended Squitter** broadcast packets:
  - DF17 / DF18 Type Codes (TC 9-18 Airborne Position, TC 19 Airborne Velocity, TC 1-4 Aircraft ID).
  - Raw simulated 112-bit Hex squitter packets with simulated 24-bit parity.
  - Avionics integrity metrics: Navigation Integrity Category (NIC: 8), Navigation Accuracy Category for Position (NACp: 9), Source Integrity Level (SIL: 3), Geometric Vertical Accuracy (GVA: 2).
  - Full kinematic breakdowns: Ground Speed, True Airspeed, Mach number, Static Air Temperature, and Wind vectors.

---

## 🛠️ Tech Stack

- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite 8](https://vitejs.dev/)
- **3D Graphics Engine**: [Three.js (WebGL)](https://threejs.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Audio Synthesis**: Native Web Audio API (zero external sound asset dependencies)

---

## 📂 Project Structure

```
├── index.html                     # Application HTML entry point & font preloads
├── metadata.json                  # Applet metadata
├── package.json                   # Dependencies and npm build scripts
├── tsconfig.json                  # TypeScript strict compiler configuration
├── vite.config.ts                 # Vite bundler & Tailwind configuration
├── src/
│   ├── main.tsx                   # React root entry point
│   ├── App.tsx                    # Main simulation dashboard & coordinator state
│   ├── index.css                  # Tailwind styles & avionics typography
│   ├── lib/
│   │   ├── types.ts               # Core TypeScript definitions (AircraftState, ConflictAnalysis, etc.)
│   │   ├── algorithms.ts          # ADS-B, TCAS II v7.1 math & FLARM prediction algorithms
│   │   └── soundEffects.ts        # Synthetic cockpit sound synthesizer (Web Audio API)
│   └── components/
│       ├── AeroVisualizer3D.tsx   # Three.js 3D spatial visualizer with multi-camera director
│       ├── AirspaceTacticalCanvas.tsx # 2D HTML5 tactical radar with drag & heading dials
│       ├── CockpitDisplay.tsx     # Mock cockpit CDTI radar and TCAS VSI display
│       ├── ConflictResolutionModal.tsx # Live interactive pilot decision prompter
│       ├── SimulationControls.tsx # Play, pause, speed, step, reset, and audio controls
│       └── TelemetryPanel.tsx     # ADS-B raw hex packets, integrity metrics, & math logs
```

---

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- `npm` or `bun` or `yarn`

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/aeropredict-simulation.git
   cd aeropredict-simulation
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000) in your browser.

4. **Build for production:**
   ```bash
   npm run build
   ```
   The production-ready assets will be generated in the `dist/` directory.

---

## 📐 Mathematical Formulation

### TCAS Horizontal Tau ($\tau$)
$$\tau = -\frac{r}{\dot{r}} = -\frac{r \cdot r}{\mathbf{r} \cdot \mathbf{v}_{\text{rel}}}$$
where $r$ is horizontal distance, $\dot{r}$ is closure rate (negative for converging aircraft), and $\tau_{\text{mod}}$ applies the Distance Modification factor ($D_{\text{MOD}}$):
$$\tau_{\text{mod}} = -\frac{r^2 - D_{\text{MOD}}^2}{r \cdot \dot{r}}$$

### Closest Point of Approach (CPA)
$$t_{\text{CPA}} = -\frac{\mathbf{r}_{\text{rel}} \cdot \mathbf{v}_{\text{rel}}}{\|\mathbf{v}_{\text{rel}}\|^2}$$
$$\mathbf{d}_{\text{CPA}} = \mathbf{r}_{\text{rel}} + \mathbf{v}_{\text{rel}} \cdot t_{\text{CPA}}$$

---

## 📄 License

This project is licensed under the Apache License 2.0.
