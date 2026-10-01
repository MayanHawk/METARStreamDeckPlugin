# METAR Display

A Stream Deck plugin that displays current aviation METAR weather information for an individual airport or reporting station.

## Features

- Configure a different ICAO station on each Stream Deck key
- Automatically refreshes METAR data every 5 minutes
- Short press copies the latest METAR to the Windows clipboard
- Long press forces a fresh METAR update and copies it to the clipboard
- Wind direction, speed, and gusts displayed on the key
- Visibility displayed in standard METAR format
- Significant weather displayed when present
- Cloud information displayed when significant weather is not present
- Wind/gust conditions are indicated by the key background:
  - **Green:** 0–16 kt gust
  - **Yellow:** 17–23 kt gust
  - **Red:** 24–28 kt gust
  - **Pulsing red:** greater than 28 kt gust

## Installation

1. Install the Stream Deck software.
2. Download `com.kbowery.metar.streamDeckPlugin`
3. Double-click `com.kbowery.metar.streamDeckPlugin`.
4. Stream Deck will install the plugin.
5. Open the Stream Deck application.
6. Find **METAR Display** in the action list.
7. Drag **METAR Display** onto a Stream Deck key.

## Configuring an Airport

After adding the action to a key:

1. Select the key in Stream Deck.
2. Enter the four-character ICAO station code in the **ICAO Station** field.
3. The plugin will retrieve and display the current METAR.

### Example

Enter:

```text
KAVP
```

The key will display information from Wilkes-Barre/Scranton International Airport.

Each key can be configured independently, allowing multiple airports to be monitored simultaneously.

## Using the Key

### Short Press

A short press copies the most recently retrieved raw METAR to the Windows clipboard.

### Long Press

Hold the key for approximately 1.5 seconds.

The plugin will:

1. Show the refresh indicator.
2. Retrieve a fresh METAR.
3. Update the key display.
4. Copy the newly retrieved raw METAR to the Windows clipboard.

## Display Format

The key uses four lines:

```text
KAVP
330° 20G27
3/4SM
+TSRA
```

The fourth line prioritizes significant weather. If no significant weather is present, it displays `CLR` when applicable or the lowest reported cloud layer.

For calm winds:

```text
KAVP
CALM
10SM
CLR
```

## Data Source

METAR data is retrieved from the U.S. Federal Aviation Administration Aviation Weather Center API.

## Requirements

- Windows 10 or later
- Stream Deck software 7.1 or later
- Stream Deck hardware
- Internet connection for METAR updates

## Notes

The plugin displays aviation weather information based on the latest METAR retrieved from the data source. It should not be considered a substitute for official aviation weather products, NOTAMs, forecasts, or other required preflight information.

## Version

**0.1.0.0**

## Author

**Mayan Hawk**
