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
    longPressMs?: number | string;
    refreshMinutes?: number | string;
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

type AlertMode = "none" | "red_pulse" | "icing_pulse";

@action({ UUID: "com.kbowery.metar.display" })
export class MetarAction extends SingletonAction<MetarSettings> {

    // ============================================================
    // DEFAULT TIMING SETTINGS
    // ============================================================

    private readonly DEFAULT_LONG_PRESS_MS = 1100;
    private readonly REFRESH_INDICATOR_MS = 1500;
    private readonly DEFAULT_REFRESH_MINUTES = 5;
    private readonly PULSE_INTERVAL_MS = 1100;

    // ============================================================
    // STATE
    // ============================================================

    private timers = new Map<string, ReturnType<typeof setInterval>>();
    private keyDownTimes = new Map<string, number>();
    private latestMetars = new Map<string, string>();
    private latestGusts = new Map<string, number>();
    private pulseTimers = new Map<string, ReturnType<typeof setInterval>>();

    // ============================================================
    // SETTINGS HELPERS
    // ============================================================

    private getLongPressMs(settings?: MetarSettings): number {
        const val = Number(settings?.longPressMs);
        return Number.isFinite(val) && val >= 200 ? val : this.DEFAULT_LONG_PRESS_MS;
    }

    private getRefreshIntervalMs(settings?: MetarSettings): number {
        const mins = Number(settings?.refreshMinutes);
        const validMins = Number.isFinite(mins) && mins >= 1 ? mins : this.DEFAULT_REFRESH_MINUTES;
        return validMins * 60 * 1000;
    }

    // ============================================================
    // STREAM DECK LIFECYCLE
    // ============================================================

    override async onWillAppear(ev: WillAppearEvent<MetarSettings>): Promise<void> {
        if (!ev.action.isKey()) return;

        const icao = this.normalizeIcao(ev.payload.settings.icao);
        if (!icao) {
            await ev.action.setTitle("SET\nICAO");
            return;
        }

        const intervalMs = this.getRefreshIntervalMs(ev.payload.settings);
        await this.refresh(ev.action.id, ev.action, icao);
        this.startTimer(ev.action.id, ev.action, icao, intervalMs);
    }

    override async onWillDisappear(ev: WillDisappearEvent<MetarSettings>): Promise<void> {
        this.stopTimer(ev.action.id);
        this.keyDownTimes.delete(ev.action.id);
        this.stopPulse(ev.action.id);
    }

    override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<MetarSettings>): Promise<void> {
        if (!ev.action.isKey()) return;

        const icao = this.normalizeIcao(ev.payload.settings.icao);
        this.stopTimer(ev.action.id);

        if (!icao) {
            this.latestMetars.delete(ev.action.id);
            this.latestGusts.delete(ev.action.id);
            this.stopPulse(ev.action.id);
            await ev.action.setTitle("SET\nICAO");
            return;
        }

        const intervalMs = this.getRefreshIntervalMs(ev.payload.settings);
        await ev.action.setTitle(`${icao}\nFETCH`);
        await this.refresh(ev.action.id, ev.action, icao);
        this.startTimer(ev.action.id, ev.action, icao, intervalMs);
    }

    // ============================================================
    // BUTTON PRESS HANDLING
    // ============================================================

    override async onKeyDown(ev: KeyDownEvent<MetarSettings>): Promise<void> {
        this.keyDownTimes.set(ev.action.id, Date.now());
    }

    override async onKeyUp(ev: KeyUpEvent<MetarSettings>): Promise<void> {
        const down = this.keyDownTimes.get(ev.action.id);
        this.keyDownTimes.delete(ev.action.id);

        if (!down) return;

        const elapsed = Date.now() - down;
        const icao = this.normalizeIcao(ev.payload.settings.icao);
        if (!icao) return;

        const longPressThreshold = this.getLongPressMs(ev.payload.settings);

        // LONG PRESS = FETCH FRESH METAR + COPY
        if (elapsed >= longPressThreshold) {
            await ev.action.setTitle(`${icao}\nREFRESH`);

            await this.updateKeyVisual(
                ev.action,
                this.latestGusts.get(ev.action.id),
                "none",
                true
            );

            await new Promise(resolve => setTimeout(resolve, this.REFRESH_INDICATOR_MS));

            await this.refresh(ev.action.id, ev.action, icao);

            const metar = this.latestMetars.get(ev.action.id);
            if (metar) {
                await this.copyToClipboard(metar);
                await ev.action.showOk();
            }
            return;
        }

        // SHORT PRESS = COPY LAST METAR
        const metar = this.latestMetars.get(ev.action.id);
        if (metar) {
            await this.copyToClipboard(metar);
            await ev.action.showOk();
            return;
        }

        // NO METAR STORED YET = FETCH THEN COPY
        await this.refresh(ev.action.id, ev.action, icao);
        const fresh = this.latestMetars.get(ev.action.id);
        if (fresh) {
            await this.copyToClipboard(fresh);
        }
    }

    // ============================================================
    // ICAO HANDLING
    // ============================================================

    private normalizeIcao(value?: string): string | undefined {
        const icao = value?.trim().toUpperCase();
        if (!icao || !/^[A-Z0-9]{4}$/.test(icao)) {
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
        icao: string,
        intervalMs: number
    ): void {
        this.stopTimer(actionId);

        const timer = setInterval(() => {
            void this.refresh(actionId, action, icao);
        }, intervalMs);

        this.timers.set(actionId, timer);
    }

    private stopTimer(actionId: string): void {
        const timer = this.timers.get(actionId);
        if (timer) {
            clearInterval(timer);
            this.timers.delete(actionId);
        }
    }

    // ============================================================
    // METAR FETCHING & CONDITION EVALUATION
    // ============================================================

    private async refresh(
        actionId: string,
        action: any,
        icao: string
    ): Promise<void> {
        try {
            const url = `https://aviationweather.gov/api/data/metar?ids=${icao}&format=json&taf=false&hours=24`;

            const response = await fetch(url, {
                headers: {
                    "User-Agent": "StreamDeck-METAR-Display/1.0"
                }
            });

            if (response.status === 204) {
                throw new Error(`No METAR available for ${icao} in the requested time window`);
            }

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = (await response.json()) as MetarData[];

            if (!Array.isArray(data) || data.length === 0 || !data[0]?.rawOb) {
                throw new Error(`No METAR returned for ${icao}`);
            }

            const rawMetar = data[0].rawOb.trim();
            this.latestMetars.set(actionId, rawMetar);

            // Extract wind speed/gust
            const windMatch = rawMetar.match(
                /\b(\d{3}|VRB|CALM)(\d{1,3})(?:G(\d{2,3}))?KT\b/i
            );
            const speedNum = windMatch ? Number(windMatch[2]) : 0;
            const gustNum = windMatch && windMatch[3] ? Number(windMatch[3]) : 0;
            const gust = Math.max(speedNum, gustNum);

            this.latestGusts.set(actionId, gust);

            // Evaluate Icing Red Flags & Low Ceiling/Fog conditions
            const alertMode = this.evaluateAlertMode(rawMetar, data[0], gust);

            // Update Display
            await action.setTitle(this.formatDisplay(data[0], icao));

            if (alertMode !== "none") {
                await this.updateKeyVisual(action, gust, alertMode, false, true);
                this.startPulse(actionId, action, gust, alertMode);
            } else {
                this.stopPulse(actionId);
                await this.updateKeyVisual(action, gust, "none", false, true);
            }

        } catch (error) {
            const message =
                error instanceof Error
                    ? `${error.name}: ${error.message}`
                    : String(error);

            console.error("METAR refresh error:", error);
            await action.setTitle(`${icao}\n${message.substring(0, 80)}`);
        }
    }

    private evaluateAlertMode(rawMetar: string, data: MetarData, gust: number): AlertMode {
        // Strip remarks (RMK ...) so historical remarks don't trigger false weather alerts
        const body = rawMetar.split(/\bRMK\b/)[0];

        // 1. Parse Temperature & Dewpoint (C)
        let temp: number | undefined = typeof data.temp === "number" ? data.temp : undefined;
        let dewp: number | undefined = typeof data.dewp === "number" ? data.dewp : undefined;

        const tempMatch = body.match(/(?:^|\s)(M?\d{2})\/(M?\d{2})(?:\s|$)/);
        if (tempMatch) {
            const parsePart = (s: string) => (s.startsWith("M") ? -Number(s.slice(1)) : Number(s));
            if (temp === undefined) temp = parsePart(tempMatch[1]);
            if (dewp === undefined) dewp = parsePart(tempMatch[2]);
        }

        const tempLe5 = temp !== undefined && temp <= 5;
        const tempBelowZero = temp !== undefined && temp < 0;

        // 2. Check Icing Red Flags (Red/Blue Pulse)
        // A. FZRA, FZDZ, FZFG (any temp)
        if (/(?:^|\s)(?:\+|-|VC)?(?:FZRA|FZDZ|FZFG)(?:\s|$)/.test(body)) {
            return "icing_pulse";
        }

        // B. FG or BR with temp <= +5C
        if (tempLe5 && /(?:^|\s)(?:\+|-|VC)?(?:FG|BR)(?:\s|$)/.test(body)) {
            return "icing_pulse";
        }

        // C. DZ, RA, SN, RASN, PL, UP with temp <= +5C (including intensity/descriptor prefixes)
        if (
            tempLe5 &&
            /(?:^|\s)(?:\+|-|VC)?(?:TS|SH)?(?:DZ|RA|SN|RASN|PL|UP)(?:\s|$)/.test(body)
        ) {
            return "icing_pulse";
        }

        // D. BKN / OVC / VV <= 005 (<= 500 ft) with temp <= +5C
        const ceilingMatches = [...body.matchAll(/\b(BKN|OVC|VV)(\d{3})\b/g)];
        const hasCeilingLe500 = ceilingMatches.some(m => Number(m[2]) <= 5);
        if (tempLe5 && hasCeilingLe500) {
            return "icing_pulse";
        }

        // E. Below freezing (Mxx) with spread <= 3C
        if (
            tempBelowZero &&
            temp !== undefined &&
            dewp !== undefined &&
            Math.abs(temp - dewp) <= 3
        ) {
            return "icing_pulse";
        }

        // 3. Check Standard Red Pulse Conditions (Gusts > 28 kt OR any cloud/fog < 500 ft)
        const anyCloudMatches = [...body.matchAll(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g)];
        const hasCloudUnder500 = anyCloudMatches.some(m => Number(m[2]) < 5);
        const hasFog = /(?:^|\s)(?:\+|-|VC)?(?:FG|FZFG)(?:\s|$)/.test(body);

        if (gust > 28 || hasCloudUnder500 || hasFog) {
            return "red_pulse";
        }

        return "none";
    }

    // ============================================================
    // GUST COLOR
    // ============================================================

    private getGustColor(gust?: number): string {
        const g = Math.max(0, gust ?? 0);
        if (g < 17) return "#00c800"; // 0-16 kt = green
        if (g < 24) return "#ffff00"; // 17-23 kt = yellow
        return "#ff0000";             // 24+ kt = red
    }

    // ============================================================
    // TILE BACKGROUND
    // ============================================================

    private async updateKeyVisual(
        action: any,
        gust?: number,
        alertMode: AlertMode = "none",
        refreshing = false,
        pulseOn = true
    ): Promise<void> {
        let color = this.getGustColor(gust);
        let opacity = "1.0";

        if (refreshing) {
            const svg = `
                <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
                    <rect width="144" height="144" rx="12" fill="${color}" />
                    <text x="72" y="82" text-anchor="middle" font-family="Segoe UI, Arial" font-size="58" font-weight="bold" fill="white">?</text>
                </svg>
            `;
            await action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
            return;
        }

        if (alertMode === "icing_pulse") {
            color = pulseOn ? "#ff0000" : "#0055ff";
            opacity = "1.0";
        } else if (alertMode === "red_pulse") {
            color = "#ff0000";
            opacity = pulseOn ? "1.0" : "0.45";
        }

        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
                <rect width="144" height="144" rx="12" fill="${color}" opacity="${opacity}" />
            </svg>
        `;

        await action.setImage(`data:image/svg+xml,${encodeURIComponent(svg)}`);
    }

    // ============================================================
    // PULSE CONTROLLER
    // ============================================================

    private startPulse(
        actionId: string,
        action: any,
        gust: number,
        alertMode: AlertMode
    ): void {
        this.stopPulse(actionId);

        let pulseOn = true;

        const timer = setInterval(() => {
            pulseOn = !pulseOn;
            void this.updateKeyVisual(action, gust, alertMode, false, pulseOn);
        }, this.PULSE_INTERVAL_MS);

        this.pulseTimers.set(actionId, timer);
    }

    private stopPulse(actionId: string): void {
        const timer = this.pulseTimers.get(actionId);
        if (timer) {
            clearInterval(timer);
            this.pulseTimers.delete(actionId);
        }
    }

    // ============================================================
    // METAR DISPLAY FORMATTING
    // ============================================================

    private formatDisplay(data: MetarData, icao: string): string {
        // WIND
        const windMatch = data.rawOb?.match(
            /(?:^|\s)(\d{3}|VRB|CALM)(\d{1,3})(?:G(\d{2,3}))?KT(?:\s|$)/i
        );

        let wind = "Wind N/A";
        if (windMatch) {
            const direction = windMatch[1].toUpperCase();
            const speed = Number(windMatch[2]);
            const gust = windMatch[3] ? Number(windMatch[3]) : undefined;

            if (speed === 0 || direction === "CALM") {
                wind = "CALM";
            } else {
                wind = `${
                    direction === "VRB" ? "VRB" : `${Number(direction)}\u00B0`
                } ${speed}${gust !== undefined ? `G${gust}` : ""}`;
            }
        }

        // VISIBILITY
        let visibility = "Vis N/A";
        if (data.rawOb) {
            const visibilityMatch = data.rawOb.match(
                /(?:^|\s)(\d+(?:\/\d+)?|\d+\s+\d+\/\d+)SM(?:\s|$)/
            );
            if (visibilityMatch) {
                visibility = `${visibilityMatch[1]}SM`;
            }
        }

        // LINE 4 (Significant weather > CLR > Lowest cloud layer)
        const weatherMatch = data.rawOb?.match(
            /(?:^|\s)((?:\+|-|VC)?(?:TS(?:RA|SN|SG|GR|GS)?|SH(?:RA|SN|GR|GS)?|FZ(?:RA|DZ|FG)?|DZ|RA|SN|SG|IC|PL|GR|GS|BR|FG|FU|VA|DU|SA|HZ|PY))(?:\s|$)/
        );

        let line4 = "";
        if (weatherMatch) {
            line4 = weatherMatch[1];
        } else if (data.rawOb?.match(/(?:^|\s)CLR(?:\s|$)/)) {
            line4 = "CLR";
        } else {
            const cloudMatches = data.rawOb?.match(/\b(FEW|SCT|BKN|OVC|VV)(\d{3})\b/g);
            if (cloudMatches?.length) {
                const clouds = cloudMatches
                    .map(cloud => {
                        const match = cloud.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3})$/);
                        if (!match) return null;
                        return {
                            cover: match[1],
                            base: Number(match[2]) * 100
                        };
                    })
                    .filter((c): c is { cover: string; base: number } => c !== null)
                    .sort((a, b) => a.base - b.base);

                if (clouds.length > 0) {
                    line4 = `${clouds[0].cover} ${clouds[0].base}ft`;
                }
            }
        }

        return [icao, wind, visibility, line4].join("\n");
    }

    // ============================================================
    // WINDOWS CLIPBOARD
    // ============================================================

    private async copyToClipboard(text: string): Promise<void> {
        if (!text) return;

        const { execFile } = await import("node:child_process");

        await new Promise<void>((resolve, reject) => {
            const child = execFile(
                "powershell.exe",
                [
                    "-NoProfile",
                    "-NonInteractive",
                    "-Command",
                    "$input | Set-Clipboard"
                ],
                { windowsHide: true },
                error => {
                    if (error) reject(error);
                    else resolve();
                }
            );
            child.stdin?.end(text);
        });
    }
}