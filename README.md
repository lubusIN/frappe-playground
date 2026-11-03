<p align="center"><img width="160" src=".github/logo.svg" alt="Frappe Playground"></p>

![Frappe Playground](.github/banner.png)

[![Launch Playground](https://img.shields.io/badge/Launch%20Playground-3858e9?style=for-the-badge&logo=data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMy4yMiIgaGVpZ2h0PSIxMy4yMiIgdmlld0JveD0iMCAwIDEzLjIyIDEzLjIyIiBmaWxsPSJ3aGl0ZSI+PHBhdGggZD0iTTguOTQsMTMuMjJjLS4xNiwwLS4zMy0uMDItLjQ5LS4wNi0uMzItLjA4LS42Mi0uMjUtLjg2LS40OS0uMDgtLjA4LS4xNS0uMTgtLjE5LS4yOS0xLjI3LTMuNjktMi42My01LjA1LTYuNi02LjU4LS4xLS4wNC0uMTktLjEtLjI3LS4xOC0uMjMtLjI0LS40LS41NC0uNDktLjg2LS4wOC0uMzItLjA4LS42NywwLS45OS4wOS0uMzIuMjYtLjYyLjUtLjg2LjI0LS4yNC41My0uNDEuODYtLjQ5TDEwLjgzLjA2czAsMCwwLDBjLjMyLS4wOC42Ni0uMDcuOTguMDEuMzIuMDkuNjEuMjYuODQuNDkuMjQuMjQuNDEuNTMuNDkuODUuMDkuMzIuMDkuNjYuMDEuOThsLTIuMzUsOS4zOWMtLjA5LjM0LS4yNi42My0uNS44Ny0uMjQuMjQtLjU0LjQxLS44Ni41LS4xNi4wNS0uMzMuMDctLjUuMDdaTTguNzUsMTEuNjdzLjA1LjAyLjA4LjAzYy4wNy4wMi4xNS4wMi4yMiwwLC4wNy0uMDIuMTQtLjA2LjE5LS4xMXMuMDktLjEyLjExLS4xOWwyLjM1LTkuMzhjLjAyLS4wNy4wMi0uMTQsMC0uMjEtLjAyLS4wNy0uMDYtLjE0LS4xMS0uMTlzLS4xMi0uMDktLjE5LS4xMWMtLjA3LS4wMi0uMTQtLjAyLS4yMSwwTDEuOCwzLjg3Yy0uMDYuMDItLjEzLjA1LS4xOC4xMS0uMDUuMDUtLjA5LjEyLS4xMS4xOS0uMDIuMDctLjAyLjE1LDAsLjIyLDAsLjAzLjAyLjA2LjA0LjA5LDQuMTYsMS42NCw1LjgyLDMuMyw3LjIxLDcuMloiLz48L3N2Zz4K&logoSize=auto)](https://frappe-playground.lubus.in)

# Frappe Playground

Run Frappe Framework entirely in the browser with Pyodide and WebAssembly. Frappe Playground provides persistent browser-local sites, optional apps, and a static deployment that does not require a Python application server.

> [!CAUTION]
> Frappe Playground is under active development.

## Documentation

Read the [Frappe Playground documentation](https://frappe-playground.lubus.in/docs/) for:

- [using the playground](https://frappe-playground.lubus.in/docs/guide/getting-started)
- [boot flags](https://frappe-playground.lubus.in/docs/guide/boot-flags)
- [self-hosting and deployment](https://frappe-playground.lubus.in/docs/hosting/)
- [customization](https://frappe-playground.lubus.in/docs/hosting/customize)
- [architecture and inner workings](https://frappe-playground.lubus.in/docs/architecture/)
- [contributor setup and testing](https://frappe-playground.lubus.in/docs/development/)

## Local development

Docker is required to prepare the Frappe runtime on a clean checkout.

```bash
git clone https://github.com/lubusIN/frappe-playground.git
cd frappe-playground
npm install
npm run build:runtime
npm run dev
```

Open `http://localhost:5173/`. Existing runtime artifacts can be reused for client-only development.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the playground development server |
| `npm run docs:dev` | Start the documentation development server |
| `npm run docs:screenshots` | Regenerate documentation screenshots |
| `npm run build` | Build the playground and documentation into `dist/` |
| `npm run test:contract` | Run the fast contract suite |
| `npm test` | Run contract, clean-build, and browser tests |
| `npm run predeploy` | Prepare and verify the Cloudflare Pages output |

See the [contributor guide](https://frappe-playground.lubus.in/docs/development/) for prerequisites, repository structure, build behavior, and focused test commands.

## Inspiration

Frappe Playground is inspired by the foundational work of the [WordPress Playground](https://github.com/WordPress/wordpress-playground) team in bringing full-stack applications into the browser through WebAssembly.

## More Frappe Tools

Explore more open-source tools we're building for the Frappe ecosystem.

<table>
  <tr>
    <td width="50%" valign="top">
      <a href="https://github.com/lubusIN/frappe-local">
        <img src="https://raw.githubusercontent.com/lubusIN/frappe-local/main/.github/assets/logo.svg" alt="Frappe Local" height="60">
      </a>
      <br>
      Manage Frappe benches and sites visually.
    </td>
    <td width="50%" valign="top">
      <a href="https://github.com/lubusIN/frappe-brewery">
        <img src="https://raw.githubusercontent.com/lubusIN/frappe-brewery/main/.github/assets/logo.svg" alt="Frappe Brewery" height="60">
      </a>
      <br>
      An open app registry for the Frappe Apps.
    </td>
  </tr>

  <tr>
    <td width="50%" valign="top">
      <a href="https://github.com/lubusIN/frappe-vault">
        <img src="https://raw.githubusercontent.com/lubusIN/frappe-vault/main/.github/assets/logo.svg" alt="Frappe Vault" height="60">
      </a>
      <br>
      Manage secrets and passwords with Frappe.
    </td>
    <td width="50%" valign="top">
      <a href="https://github.com/lubusIN/wp-frappe-data-store">
        <img src="https://raw.githubusercontent.com/lubusIN/wp-frappe-data-store/main/.github/assets/logo.svg" alt="WP Frappe Data Store" height="60">
      </a>
      <br>
      React Data store for WordPress.
    </td>
  </tr>
</table>

[Explore all LUBUS projects →](https://github.com/lubusIN)

## Meet Your Artisans

[LUBUS](https://lubus.in/?utm_source=github&utm_medium=open-source&utm_campaign=frappe-playground) is a web design agency based in Mumbai.

<a href="https://cal.com/lubus">
<img src="https://raw.githubusercontent.com/lubusIN/.github/refs/heads/main/profile/banner.png" alt="Work with LUBUS">
</a>

## License

Frappe Playground is open-sourced licensed under the [MIT License](LICENSE).
