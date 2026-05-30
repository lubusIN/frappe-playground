# Frappe WASM Playground

A playground project bringing the entire Frappe Framework (both frontend and backend) to the browser using Pyodide and WebAssembly (WASM). This allows Frappe to run completely offline in a local Service Worker, without needing a traditional Python backend server.

## Overview

The playground consists of three main components:
1. **The Backend Worker (`public/worker.js`)**: A Service Worker that initializes Pyodide, mounts the virtual file system, loads the Frappe Python source code, and intercepts HTTP requests to act as the WSGI server.
2. **The Frontend App**: Standard Frappe frontend assets that communicate with the Service Worker via intercepted network requests.
3. **The Build System (`Dockerfile.build`, `scripts/build.sh`)**: Scripts to compile the Python environment, download Frappe 16 source, and bundle everything into a flat archive ready for the browser.

## Getting Started

1. **Build the runtime bundle**:
   Run the build script to compile the Python environment using Docker:
   ```bash
   ./scripts/build.sh
   ```
   *Note: This creates the `.tar.gz` bundles inside the `storage/` directory.*

2. **Start the local dev server**:
   Start Vite, which serves the shell app with hot reload plus the Pyodide runtime files from `public/`:
   ```bash
   npm run dev
   ```

3. **Preview the built app**:
   Build and preview the production output:
   ```bash
   npm run build
   npm start
   ```

4. **Open the App**:
   Navigate to `http://localhost:5173/` in dev, or `http://localhost:8000/` when using `npm start`.

## Testing the Playground

The project includes a suite of reusable Playwright scripts in the `tests/` directory to automate checking the health of the WASM environment and inspecting its internal state.

### 📂 Directory Structure

```text
└── tests/
    ├── e2e/                 # Automated user flows
    │   ├── boot.spec.js     # Tests if Pyodide boots without 500 errors
    │   ├── login.spec.js    # Tests the authentication flow
    │   └── desk.spec.js     # Tests full Desk/Setup Wizard load + captures a screenshot
    │
    └── debug/               # Developer inspection tools
        ├── inspect_vfs.js   # Read files from Pyodide's virtual filesystem on the fly
        └── inspect_memory.js# Read the Service Worker's active cookie jar
```

### 🚀 Running the Tests & Debug Tools

Ensure your local server (`npm run dev` or `npm start`) is running, then use NPM to execute the scripts:

**Automated Flows**
```bash
npm run test
```

**Debugging Tools**
```bash
# Inspect a specific file inside the Pyodide environment
npm run debug:vfs /home/pyodide/bench/sites/site1/site_config.json

# Dump the cookie jar to inspect active sessions
npm run debug:memory
```

> **Note:** Because these scripts use standard Playwright APIs (`page.goto`, `page.evaluate`), they can be easily extended to click through the Setup Wizard, interact with Doctypes, or assert specific UI states just like testing a real Frappe server.
