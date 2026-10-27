// after making changes, run these two commands
// npm.cmd run build
// streamdeck.cmd restart com.kbowery.metar

import streamDeck, {
    action,
    KeyDownEvent,
    KeyUpEvent,
    SingletonAction,
    WillAppearEvent,
    WillDisappearEvent,
    DidReceiveSettingsEvent
} from "@elgato/streamdeck";

type MetarSettings = {
    icao?: string;
};

type MetarData = {
    rawOb?: string;
    temp?: number;
    dewp?: number;
    wdir?: number | string;
    wspd?: number;
    wgst?: number;
    visib?: string | number;
    clouds?: Array<{
        cover?: string;
        base?: number;
    }>;
};

@action({ UUID: "com.kbowery.metar.display" })
export class MetarAction extends SingletonAction<MetarSettings> {

    // ============================================================
    // TIMING SETTINGS. Replace the number with your desired delay (ms).
    // ============================================================

    // Length of a long press
    private readonly LONG_PRESS_MS = 1100;

    // Refresh indicator persists
    private readonly REFRES_INDICATOR_MS = 1500; // keeping original name or matching original property below: REFRESH_INDICATOR_MS
    private readonly REFRESH_INDICATOR_MS = 1500;

    // Automatic METAR refresh interval.
    private readonly REFRESH_INTERVAL_MS = 5 * 60 * 1000;

    // Caution pulse frequency
    private readonly PULSE_INTERVAL_MS = 1100;


    // ============================================================
    // STATE
    // ============================================================

    private timers =
        new Map<string, ReturnType<typeof setInterval>>();
    private keyDownTimes =
        new Map<string, number>();
    private latestMetars =
        new Map<string, string>();
    private latestGusts =
        new Map<string, number>();
    private pulseTimers =
        new Map<string, ReturnType<typeof setInterval>>();

    // ============================================================
    // STREAM DECK LIFECYCLE
    // ============================================================

    override async onWillAppear(
        ev: WillAppearEvent<MetarSettings>
    ): Promise<void> {

        if (!ev.action.isKey()) return;

        const icao = this.normalizeIcao(
            ev.payload.settings.icao
        );

        if (!icao) {
            await ev.action.setTitle("SET\nICAO");
            return;
        }

        await this.refresh(
            ev.action.id,
            ev.action,
            icao
        );

        this.startTimer(
            ev.action.id,
            ev.action,
            icao
        );
    }

    override async onWillDisappear(
        ev: WillDisappearEvent<MetarSettings>
    ): Promise<void> {

        this.stopTimer(ev.action.id);
        this.keyDownTimes.delete(ev.action.id);
        this.stopPulse(ev.action.id);
    }

    override async onDidReceiveSettings(
        ev: DidReceiveSettingsEvent<MetarSettings>
    ): Promise<void> {

        if (!ev.action.isKey()) return;

        const icao = this.normalizeIcao(
            ev.payload.settings.icao
        );

        this.stopTimer(ev.action.id);

        if (!icao) {

            this.latestMetars.delete(
                ev.action.id
            );

            this.latestGusts.delete(
                ev.action.id
            );

            this.stopPulse(
                ev.action.id
            );

            await ev.action.setTitle(
                "SET\nICAO"
            );

            return;
        }

        await ev.action.setTitle(
            `${icao}\nFETCH`
        );

        await this.refresh(
            ev.action.id,
            ev.action,
            icao
        );

        this.startTimer(
            ev.action.id,
            ev.action,
            icao
        );
    }


    // ============================================================
    // BUTTON PRESS HANDLING
    // ============================================================

    override async onKeyDown(
        ev: KeyDownEvent<MetarSettings>
    ): Promise<void> {

        this.keyDownTimes.set(
            ev.action.id,
            Date.now()
        );
    }

    override async onKeyUp(
        ev: KeyUpEvent<MetarSettings>
    ): Promise<void> {

        const down =
            this.keyDownTimes.get(
                ev.action.id
            );

        this.keyDownTimes.delete(
            ev.action.id
        );

        if (!down) return;

        const elapsed =
            Date.now() - down;

        const icao =
            this.normalizeIcao(
                ev.payload.settings.icao
            );

        if (!icao) return;


        // --------------------------------------------------------
        // LONG PRESS = FETCH FRESH METAR + COPY
        // --------------------------------------------------------

        if (elapsed >= this.LONG_PRESS_MS) {

            await ev.action.setTitle(
                `${icao}\nREFRESH`
            );

            await this.updateKeyVisual(
                ev.action,
                this.latestGusts.get(
                    ev.action.id
                ),
                true
            );

            await new Promise(resolve =>
                setTimeout(
                    resolve,
                    this.REFRESH_INDICATOR_MS
                )
            );

            await this.refresh(
                ev.action.id,
                ev.action,
                icao
            );

            const metar =
                this.latestMetars.get(
                    ev.action.id
                );

            if (metar) {

                await this.copyToClipboard(
                    metar
                );

                await ev.action.showOk();
            }

            return;
        }


        // --------------------------------------------------------
        // SHORT PRESS = COPY LAST METAR
        // --------------------------------------------------------

        const metar =
            this.latestMetars.get(
                ev.action.id
            );

        if (metar) {

            await this.copyToClipboard(
                metar
            );

            await ev.action.showOk();

            return;
        }


        // --------------------------------------------------------
        // NO METAR STORED YET = FETCH THEN COPY
        // --------------------------------------------------------

        await this.refresh(
            ev.action.id,
            ev.action,
            icao
        );

        const fresh =
            this.latestMetars.get(
                ev.action.id
            );

        if (fresh) {

            await this.copyToClipboard(
                fresh
            );
        }
    }


    // ============================================================
    // ICAO HANDLING
    // ============================================================

    private normalizeIcao(
        value?: string
    ): string | undefined {

        const icao =
            value?.trim().toUpperCase();

        if (
            !icao ||
            !/^[A-Z0-9]{4}$/.test(icao)
        ) {
            return undefined;
        }

        return icao;
    }


    // ============================================================
    // AUTOMATIC REFRESH TIMER
    // ============================================================

    private startTimer(
        actionId: string,
        action: any,
        icao: string
    ): void {

        this.stopTimer(actionId);

        const timer =
            setInterval(
                () => {

                    void this.refresh(
                        actionId,
                        action,
                        icao
                    );

                },
                this.REFRESH_INTERVAL_MS
            );

        this.timers.set(
            actionId,
            timer
        );
    }

    private stopTimer(
        actionId: string
    ): void {

        const timer =
            this.timers.get(
                actionId
            );

        if (timer) {

            clearInterval(timer);

            this.timers.delete(
                actionId
            );
        }
    }


    // ============================================================
    // METAR FETCHING
    // ============================================================

    private async refresh(
        actionId: string,
        action: any,
        icao: string
    ): Promise<void> {

        try {

            const url =
                `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&taf=false&hours=24`;

            const response =
                await fetch(
                    url,
                    {
                        headers: {
                            "User-Agent":
                                "StreamDeck-METAR-Display/1.0"
                        }
                    }
                );

            if (response.status === 204) {
                throw new Error(`No METAR available for ${icao} in the requested time window`);
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as MetarData[];

            if (
                !Array.isArray(data) ||
                data.length === 0 ||
                !data[0]?.rawOb
            ) {

                throw new Error(
                    `No METAR returned for ${icao}`
                );
            }

            const rawMetar =
                data[0].rawOb.trim();


            // ----------------------------------------------------
            // STORE RAW METAR
            // ----------------------------------------------------

            this.latestMetars.set(
                actionId,
                rawMetar
            );


            // ----------------------------------------------------
            // EXTRACT WIND GUST (Updated to support 2-3 digits & VRB)
            // ----------------------------------------------------

            const windMatch =
                rawMetar.match(
                    /\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/
                );

            const gust =
                windMatch
                    ? Math.max(
                        Number(windMatch[2]),
                        Number(windMatch[3] ?? 0)
                    )
                    : 0;

            this.latestGusts.set(
                actionId,
                gust
            );


            // ----------------------------------------------------
            // UPDATE DISPLAY
            // ----------------------------------------------------

            await action.setTitle(
                this.formatDisplay(
                    data[0],
                    icao
                )
            );

            await this.updateKeyVisual(
                action,
                gust
            );


            // ----------------------------------------------------
            // START/STOP RED PULSE
            // ----------------------------------------------------

            if (gust > 28) {

                this.startPulse(
                    actionId,
                    action,
                    gust
                );

            } else {

                this.stopPulse(
                    actionId
                );
            }

        } catch (error) {
            const message =
                error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : String(error);

            console.error(
                "METAR refresh error:",
                error
            );

            await action.setTitle(
                `${icao}\n${message.substring(0, 80)}`
            );
        }
    }


    // ============================================================
    // GUST COLOR
    // ============================================================

    private getGustColor(
        gust?: number
    ): string {

        const g =
            Math.max(
                0,
                gust ?? 0
            );


        // 0-16 kt = green
        if (g < 17) {
            return "#00c800";
        }


        // 17-23 kt = yellow
        if (g < 24) {
            return "#ffff00";
        }


        // 24-28 kt = red
        return "#ff0000";
    }


    // ============================================================
    // TILE BACKGROUND
    // ============================================================

    private async updateKeyVisual(
        action: any,
        gust?: number,
        refreshing = false,
        pulseOn = true
    ): Promise<void> {

        const color =
            this.getGustColor(
                gust
            );


        // --------------------------------------------------------
        // REFRESH INDICATOR
        // --------------------------------------------------------

        if (refreshing) {

            const svg = `
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="144"
                    height="144"
                    viewBox="0 0 144 144"
                >
                    <rect
                        width="144"
                        height="144"
                        rx="12"
                        fill="${color}"
                    />

                    <text
                        x="72"
                        y="82"
                        text-anchor="middle"
                        font-family="Segoe UI, Arial"
                        font-size="58"
                        font-weight="bold"
                        fill="white"
                    >?</text>
                </svg>
            `;

            await action.setImage(
                `data:image/svg+xml,${encodeURIComponent(svg)}`
            );

            return;
        }


        // --------------------------------------------------------
        // PULSE WHEN GUST > 28 KT
        // --------------------------------------------------------

        const opacity =
            gust !== undefined && gust > 28
                ? (
                    pulseOn
                        ? "1.0"
                        : "0.45"
                )
                : "1.0";


        const svg = `
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="144"
                height="144"
                viewBox="0 0 144 144"
            >
                <rect
                    width="144"
                    height="144"
                    rx="12"
                    fill="${color}"
                    opacity="${opacity}"
                />
            </svg>
        `;

        await action.setImage(
            `data:image/svg+xml,${encodeURIComponent(svg)}`
        );
    }


    // ============================================================
    // RED PULSE
    // ============================================================

    private startPulse(
        actionId: string,
        action: any,
        gust: number
    ): void {

        this.stopPulse(
            actionId
        );

        let pulseOn = true;

        const timer =
            setInterval(
                () => {

                    pulseOn = !pulseOn;

                    void this.updateKeyVisual(
                        action,
                        gust,
                        false,
                        pulseOn
                    );

                },
                this.PULSE_INTERVAL_MS
            );

        this.pulseTimers.set(
            actionId,
            timer
        );
    }

    private stopPulse(
        actionId: string
    ): void {

        const timer =
            this.pulseTimers.get(
                actionId
            );

        if (timer) {

            clearInterval(
                timer
            );

            this.pulseTimers.delete(
                actionId
            );
        }
    }


    // ============================================================
    // METAR DISPLAY FORMATTING
    // ============================================================

    private formatDisplay(
        data: MetarData,
        icao: string
    ): string {

        // --------------------------------------------------------
        // WIND (Updated to support 2-3 digits & VRB cleanly)
        // --------------------------------------------------------

        const windMatch =
            data.rawOb?.match(
                /(?:^|\s)(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT(?:\s|$)/
            );

        let wind =
            "Wind N/A";

        if (windMatch) {

            const direction =
                windMatch[1];

            const speed =
                Number(windMatch[2]);

            const gust =
                windMatch[3]
                    ? Number(windMatch[3])
                    : undefined;


            if (speed === 0) {

                wind = "CALM";

            } else {

                wind =
                    `${direction === "VRB"
                        ? "VRB"
                        : `${Number(direction)}\u00B0`
                    } ${speed}${
                        gust !== undefined
                            ? `G${gust}`
                            : ""
                    }`;
            }
        }


        // --------------------------------------------------------
        // VISIBILITY
        // --------------------------------------------------------

        let visibility =
            "Vis N/A";

        if (data.rawOb) {

            const visibilityMatch =
                data.rawOb.match(
                    /(?:^|\s)(\d+(?:\/\d+)?|\d+\s+\d+\/\d+)SM(?:\s|$)/
                );

            if (visibilityMatch) {

                visibility =
                    `${visibilityMatch[1]}SM`;
            }
        }


        // --------------------------------------------------------
        // LINE 4
        //
        // Priority:
        // 1. Significant weather
        // 2. CLR
        // 3. Lowest cloud layer (with safety guards)
        // --------------------------------------------------------

        const weatherMatch =
            data.rawOb?.match(
                /(?:^|\s)((?:\+|-|VC)?(?:TS(?:RA|SN|SG|GR|GS)?|SH(?:RA|SN|GR|GS)?|FZ(?:RA|DZ|FG)?|DZ|RA|SN|SG|IC|PL|GR|GS|BR|FG|FU|VA|DU|SA|HZ|PY))(?:\s|$)/
            );

        let line4 =
            "";


        // Significant weather

        if (weatherMatch) {

            line4 =
                weatherMatch[1];


        // Clear skies

        } else if (
            data.rawOb?.match(
                /(?:^|\s)CLR(?:\s|$)/
            )
        ) {

            line4 =
                "CLR";


        // Lowest cloud layer

        } else {

            const cloudMatches =
                data.rawOb?.match(
                    /\b(FEW|SCT|BKN|OVC)(\d{3})\b/g
                );

            if (cloudMatches?.length) {

                const clouds =
                    cloudMatches
                        .map(cloud => {

                            const match =
                                cloud.match(
                                    /^(FEW|SCT|BKN|OVC)(\d{3})$/
                                );

                            if (!match) return null;

                            return {
                                cover: match[1],
                                base:
                                    Number(match[2]) * 100
                            };
                        })
                        .filter((c): c is { cover: string; base: number } => c !== null)
                        .sort(
                            (a, b) =>
                                a.base - b.base
                        );

                if (clouds.length > 0) {
                    line4 =
                        `${clouds[0].cover} ${clouds[0].base}ft`;
                }
            }
        }


        // --------------------------------------------------------
        // FINAL TILE DISPLAY
        // --------------------------------------------------------

        return [
            icao,
            wind,
            visibility,
            line4
        ].join("\n");
    }


    // ============================================================
    // WINDOWS CLIPBOARD
    // ============================================================

    private async copyToClipboard(
        text: string
    ): Promise<void> {

        if (!text) return;

        const { execFile } =
            await import(
                "node:child_process"
            );

        await new Promise<void>(
            (resolve, reject) => {

                const child =
                    execFile(
                        "powershell.exe",
                        [
                            "-NoProfile",
                            "-NonInteractive",
                            "-Command",
                            "$input | Set-Clipboard"
                        ],
                        {
                            windowsHide: true
                        },
                        error => {

                            if (error) {
                                reject(error);
                            } else {
                                resolve();
                            }
                        }
                    );

                child.stdin?.end(
                    text
                );
            }
        );
    }
}