# ChatGPT Conversation Usage

A compact browser extension that estimates how close a ChatGPT conversation may be to its practical maximum length.

It works directly from the open ChatGPT conversation. No DevTools, HAR export, Python script, or external server is required.

> [!IMPORTANT]
> This project uses internal ChatGPT endpoints and an experimental metric derived from real-world observations. It is not an official OpenAI tool, and the displayed percentage is not an official token or context counter.

## Features

- One-click analysis from a `chatgpt.com/c/...` conversation
- Supports regular conversations and ChatGPT Projects
- Free, Plus, and Pro profiles
- Compact usage gauge
- Clear warning states
- Direct detection of ChatGPT's maximum-length notice
- Collapsible details panel
- Local token estimates
- Active branch and full conversation-tree statistics
- Assistant, tool, hidden, and system-message counts
- Apparent compression estimate
- Detected model
- Copyable diagnostic statistics
- No conversation text is stored or sent to a third-party server

## How the estimate works

The main score is based on an **effective load**:

```text
effective load =
assistant messages
+ tool messages
- hidden messages
- system messages
```

The reasoning is empirical:

- assistant and tool nodes increase the technical load of a long conversation;
- hidden and system nodes often increase when ChatGPT summarizes, migrates, or compacts older context;
- in observed Plus conversations, this adjusted value separated working conversations from conversations that displayed the maximum-length message better than raw token totals or total node counts.

### Current thresholds

| Plan | Experimental threshold |
|---|---:|
| Free | 900 |
| Plus | 1,980 |
| Pro | 4,230 |

Free and Pro currently preserve the same relative scaling used during the earlier node-based calibration. Plus has the strongest real-world calibration.

### Status ranges

| Estimated usage | Status |
|---|---|
| Below 70% | OK |
| 70%–85% | Watch closely |
| 85%–97% | Critical |
| 97%–100% | Very critical |
| 100% or more | Likely limit |
| ChatGPT maximum-length notice detected | Confirmed limit |

The extension always prioritizes a confirmed maximum-length message over the calculated estimate.

## What the details panel shows

Open **Useful details** to view:

- effective load and plan threshold;
- assistant and tool counts;
- hidden and system-message counts;
- apparent compression;
- estimated historical tokens;
- estimated weighted tokens in the most recent 128 messages;
- active branch and full tree size;
- turns and messages;
- code and tool shares;
- files and summary markers;
- detected model.

Token counts are estimated locally. They are not official OpenAI usage values.

## Installation

### Chrome

1. Download or clone this repository.
2. If you downloaded a ZIP, extract it.
3. Open:

   ```text
   chrome://extensions
   ```

4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the folder that contains `manifest.json`.
7. Open a ChatGPT conversation and click the extension icon.

### Microsoft Edge

1. Download or clone this repository.
2. Extract the ZIP if necessary.
3. Open:

   ```text
   edge://extensions
   ```

4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the folder that contains `manifest.json`.

### Firefox — temporary development installation

1. Download or clone this repository.
2. Extract the ZIP if necessary.
3. Open:

   ```text
   about:debugging#/runtime/this-firefox
   ```

4. Click **Load Temporary Add-on**.
5. Select `manifest.json`.

Firefox removes temporary add-ons after the browser restarts. A permanent public Firefox release must be signed through Mozilla Add-ons.

## Usage

1. Sign in to ChatGPT.
2. Open a conversation with a URL similar to:

   ```text
   https://chatgpt.com/c/6a59faf2-2448-83ed-87cf-cc378a927777
   ```

3. Click the extension icon.
4. Select Free, Plus, or Pro.
5. The analysis starts automatically.
6. Open **Useful details** for advanced metrics.
7. Use **Copy statistics** to copy a diagnostic line without copying the conversation text.

For very large conversations, keep the popup open while the analysis is running.

## Privacy

The extension:

- communicates only with `chatgpt.com`;
- uses the ChatGPT session already open in the browser;
- does not send conversation content to an external server;
- does not store conversation text;
- stores only the selected plan locally;
- returns structural statistics to the popup.

## Technical overview

The extension uses Manifest V3.

Main files:

```text
manifest.json       Browser-extension manifest
popup.html          Popup interface
popup.css           Popup styling
popup.js            UI logic
core.js             Effective-load calculation and status thresholds
page-analyzer.js    Authenticated ChatGPT conversation retrieval and analysis
```

The page analyzer:

1. reads the current conversation ID from the `/c/...` URL;
2. retrieves the active ChatGPT session token;
3. retrieves the active account ID;
4. detects whether the conversation belongs to a ChatGPT Project;
5. requests the conversation JSON from ChatGPT;
6. follows `current_node` through its parents to identify the active branch;
7. calculates structural and estimated text metrics;
8. returns statistics only, not the full conversation, to the popup.

## Known limitations

- ChatGPT does not expose an official “conversation percentage used” counter.
- The formula and thresholds are experimental.
- Different models, plans, Projects, files, memory behavior, and server-side compaction may affect the real limit.
- Internal ChatGPT endpoints can change without notice.
- Local token estimates are approximate.
- Free and Pro thresholds need additional real-world calibration.
- A conversation may fail for reasons unrelated to maximum length.

## Development

Validate JavaScript syntax:

```bash
node --check core.js
node --check popup.js
node --check page-analyzer.js
```

To test changes:

1. reload the unpacked extension from the browser's extensions page;
2. reload the ChatGPT tab;
3. open the extension popup;
4. compare the copied diagnostic line across known working and blocked conversations.

## Publishing

For a public release:

- publish the Chrome build through the Chrome Web Store;
- publish and sign the Firefox build through Mozilla Add-ons;
- provide a privacy policy that explains that no conversation content is sent to a third-party server;
- clearly label the estimate as experimental and unofficial.

## Disclaimer

This project is unofficial and is not affiliated with, endorsed by, or sponsored by OpenAI.

“ChatGPT” and “OpenAI” are trademarks of their respective owner.
