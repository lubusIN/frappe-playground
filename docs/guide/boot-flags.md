# Boot flags

Boot flags are URL query parameters that configure what the playground does during startup. Add them to a playground URL to create or reopen an instance, install catalog apps, sign in, complete onboarding, or select a landing route. They are useful for reproducible demos and issue reports.

## Parameters

| Parameter | Accepted value | Effect |
| --- | --- | --- |
| `name` | A display name | Names a newly created playground. It does not rename an existing one. |
| `apps` | Comma-separated app IDs | Installs missing apps sequentially before navigation. IDs must exist in the published catalog. |
| `login` | `1`, `true`, or `auto` | Signs in with the built-in Administrator demo credentials. |
| `onboarding` | `0` or `false` | Signs in, calls Frappe’s `setup_complete` API with detected locale defaults, and skips the Setup Wizard. |
| `path` | A URL path | Opens this route after boot. `/blank` is normalized to `/`. |

When `path` is omitted, an automatic login lands at `/desk`; otherwise the default is `/`.

`name` has one additional selection rule: if an instance with exactly that display name already exists, the shell opens it instead of creating another. Without `name`, using `apps` or `onboarding` creates a new instance so an automation URL does not silently modify the currently active site. A URL containing only `login` or `path` operates on the normally selected instance.

After successful boot processing, the shell removes the complete query string from the top-level URL. This prevents app installation or onboarding flags from running again when the user switches instances or reloads the shell.

## Examples

Create a named ERPNext playground, complete setup, and open Desk:

```text
/?name=ERPNext%20Demo&apps=erpnext&onboarding=0
```

Install CRM and open its route after automatic login:

```text
/?name=CRM%20Demo&apps=crm&login=auto&path=/crm
```

Open a specific Desk page without automatic login:

```text
/?path=/app/todo
```

## Onboarding locale behavior

Automated onboarding derives the language and time zone from browser APIs. It starts with `United States`, then tries `get.geojs.io` for a country and caches a successful result in `localStorage`. If that service returns a non-success response, the code tries the region in the browser locale; if the request throws or locale conversion is unavailable, the initial `United States` value remains. Failure to detect a country does not prevent the remaining setup flow.

::: tip Share the recipe, not the state
A boot URL communicates configuration. It does not transfer an existing instance’s IndexedDB data to another browser or origin. Display names are not unique identifiers, so avoid creating multiple manually named instances with the same name when links depend on name selection.
:::
