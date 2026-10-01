import streamDeck from "@elgato/streamdeck";

import { MetarAction } from "./actions/metar";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new MetarAction());

streamDeck.connect();
