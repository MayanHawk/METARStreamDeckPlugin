# METAR Display

A Stream Deck plugin that displays current aviation METAR weather information for an individual airport or reporting station.

## Features

- **Customizable ICAO & Timings:** Configure a different ICAO station, adjust the long-press duration via a slider, and set custom auto-refresh intervals (in minutes) directly from the Stream Deck Property Inspector.
- **Short & Long Press Actions:** 
  - Short press copies the latest raw METAR to the Windows clipboard.
  - Long press forces a fresh METAR update, updates the display, and copies it to the clipboard.
- **Wind & Environmental Display:** Wind direction, speed, gusts, standard visibility, significant weather, and cloud layers are clearly formatted across four lines.
- **Dynamic Visual Alert States:** Key backgrounds change dynamically based on wind and hazard conditions:
  - **Green:** 0–16 kt gust
  - **Yellow:** 17–23 kt gust
  - **Red:** 24–28 kt gust
  - **Pulsing Red:** Gusts greater than 28 kt, or any cloud/fog below 500 ft.
  - **Pulsing Red & Blue:** Advanced Icing Red Flag conditions detected.

## Advanced Safety & Icing Red Flags (v2.0)

The plugin automatically evaluates METAR observations against critical winter/icing thresholds and highlights hazards on the key background:

1. **Icing Red Flags (Red & Blue Alternating Pulse):**
   - Freezing precipitation: `FZRA`, `FZDZ`, `FZFG`
   - Fog or mist (`FG`, `BR`) when temperature is $\le +5^\circ\text{C}$
   - Precipitation (`DZ`, `RA`, `SN`, `RASN`, `PL`, `UP`) when temperature is $\le +5^\circ\text{C}$
   - Low ceiling or vertical visibility ($\le 005$ / $\le 500\text{ ft}$) when temperature is $\le +5^\circ\text{C}$
   - Near-saturation below-freezing air (`M02`/`M03` with temperature/dewpoint spread $\le 3^\circ\text{C}$)

2. **Low Ceiling / Fog Alert (Flashing Red):**
   - Any cloud layer or fog reported below $500\text{ ft}$ triggers an immediate red pulse warning.

## Installation

1. Install the Stream Deck software.
2. Download `com.kbowery.metar.streamDeckPlugin`
3. Double-click `com.kbowery.metar.streamDeckPlugin`.
4. Stream Deck will install the plugin.
5. Open the Stream Deck application.
6. Find **METAR Display** in the action list.
7. Drag **METAR Display** onto a Stream Deck key.

## Configuring an Airport & Settings

After adding the action to a key:

1. Select the key in Stream Deck.
2. Enter the four-character ICAO station code in the **ICAO Station** field.
3. Adjust the **Long Press (ms)** slider to your preferred hold duration.
4. Set the **Refresh (min)** interval to your desired auto-update frequency.

### Example

Enter:
```text
KAVP
```

The key will display information from Wilkes-Barre/Scranton International Airport, updating according to your configured schedule.

## Bug Fixes & Code Custodial Improvements (v2.0)

- **Flexible Wind Parsing:** Upgraded regex matchers to seamlessly support 1-to-3 digit wind speeds (`00000KT`, `04005KT`) and variable (`VRB`) or calm (`CALM`) wind conditions without throwing parser exceptions.
- **Negative Temperature Handling:** Added safe parsing for negative temperatures prefixed with `M` (e.g., `M01`), preventing runtime `NaN` evaluation crashes during cold-weather ops.
- **Safe Cloud Layer Mapping:** Implemented non-null type guards and validation filters around cloud layer array parsing to protect against malformed reporting blocks.
- **Remarks Isolation:** Stripped historical remarks (`RMK ...`) prior to condition evaluation to eliminate false hazard triggers from legacy observation text.

## Version

**2.0.0**

## Author

**Mayan Hawk**