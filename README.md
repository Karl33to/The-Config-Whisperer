<div align="center">
  <img src="logo.svg" alt="The Config Whisperer Logo" width="120" height="120" />
  <h1>The Config Whisperer</h1>
  <p><strong>A rules-driven configuration inspection and validation tool.</strong></p>

  [![Live Tool](https://img.shields.io/badge/Live-Tool-blueviolet.svg)](https://Karl33to.github.io/The-Config-Whisperer/)
  [![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
  [![PWA](https://img.shields.io/badge/PWA-Installable-brightgreen.svg)](https://web.dev/progressive-web-apps/)
</div>

---

### 🌐 [Click here to open the Live Tool](https://Karl33to.github.io/The-Config-Whisperer/)

The Config Whisperer is a rules-driven configuration inspection and validation tool for text-based configuration exports.

It reads configuration files, separates lines using token-based matching, and checks the resulting entries against a JSON ruleset. While the initial use case and sample rulesets are focused on Betaflight CLI exports, the core validator is intentionally generic and can be adapted for any line-based configuration format.

## 📱 Install as an App
This tool is a Progressive Web App (PWA). You can install it on your Desktop or Mobile device by clicking the **Install** icon in your browser's address bar. Once installed, it works **entirely offline**.

## 🔒 Privacy First
Validation and rule editing happen entirely within your browser. No configuration data or rulesets are ever uploaded to a server.

## 🛠️ Versatile Validation
The Whisperer is designed to be adaptable for many different applications:
- **Network device** configuration checking.
- **Embedded or IoT** fleet validation.
- **Robotics competition** inspection.
- **Server and service** configuration review.
- **Machine or equipment** setup verification.

### How it works:
- **Parameter Matching:** Supports 1 to 4 token matching (e.g., `set power_index`, `aux 0 1`).
- **Flexible Rules:** Define rules for exact matches, range checks, positional values, or "forbidden" lines.
- **Custom Rulesets:** Create, edit, and export your own JSON rulesets to share with others.

## How to Use
1. **Load Ruleset:** Drag and drop a `ruleset.json` or paste the JSON into the left panel.
2. **Input Config:** Paste your configuration text or drop a `.txt`/`.config` file.
3. **Validate:** Click **Validate** to see immediate feedback.
4. **Edit:** Click any line in the results to open the **Rule Editor** and fine-tune your requirements.
5. **Export:** Use the **Export ruleset** button to save your customized rules.

## Deployment
This project is designed to be hosted on **GitHub Pages**. Simply enable Pages in your repository settings pointing to the `main` branch to make the tool live.

---
*(c) 2025-2026 Karl Payne - Licensed under the [GNU GPL v3](LICENSE).*
