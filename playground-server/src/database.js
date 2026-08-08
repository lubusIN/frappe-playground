import { fetchBinary } from './filesystem.js'

function removeIfExists(fs, path) {
  try {
    if (fs.analyzePath(path).exists) fs.unlink(path)
  } catch (_) {
    // Ignore transient SQLite sidecar cleanup errors.
  }
}

export async function checkpointDatabase(pyodide, dbPath) {
  await pyodide.runPythonAsync(`
import sqlite3
try:
    conn = sqlite3.connect('${dbPath}')
    conn.execute('PRAGMA wal_checkpoint(TRUNCATE)')
    conn.close()
except Exception:
    pass
  `)
  removeIfExists(pyodide.FS, `${dbPath}-wal`)
  removeIfExists(pyodide.FS, `${dbPath}-shm`)
}

export async function repairCompletedSiteDefaults(pyodide, dbPath) {
  await pyodide.runPythonAsync(`
import sqlite3
conn = sqlite3.connect('${dbPath}')
try:
    values = [row[0] for row in conn.execute(
        "select is_setup_complete from 'tabInstalled Application' where app_name in ('frappe', 'erpnext')"
    ).fetchall()]
    home_page = conn.execute(
        "select defvalue from tabDefaultValue where parent='__default' and defkey='desktop:home_page'"
    ).fetchone()
    if values and all(bool(value) for value in values) and home_page and home_page[0] == 'setup-wizard':
        conn.execute("update tabDefaultValue set defvalue='workspace' where parent='__default' and defkey='desktop:home_page'")
        conn.commit()
finally:
    conn.close()
  `)
}

export async function resetFreshSiteSetupState(pyodide, dbPath) {
  await pyodide.runPythonAsync(`
import sqlite3
conn = sqlite3.connect('${dbPath}')
try:
    conn.execute("update tabSingles set value='0' where doctype='System Settings' and field='setup_complete'")
    conn.execute("update 'tabInstalled Application' set is_setup_complete=0")
    updated = conn.execute(
        "update tabDefaultValue set defvalue='setup-wizard' where parent='__default' and defkey='desktop:home_page'"
    ).rowcount
    if not updated:
        conn.execute(
            "insert into tabDefaultValue (name, parent, defkey, defvalue) values (?, '__default', 'desktop:home_page', 'setup-wizard')",
            ('__default:desktop:home_page',),
        )
    conn.commit()
finally:
    conn.close()
  `)
}

export async function initializeSiteDatabase({
  pyodide,
  fetchFn,
  stateStore,
  dbPath,
  storageEndpoint,
  freshSession,
  log,
  logger = console,
}) {
  let restored = false
  if (!freshSession) {
    log('Restoring isolated database...')
    logger.time('loadStateFromIDB')
    restored = await stateStore.load(dbPath)
    logger.timeEnd('loadStateFromIDB')
  }

  if (freshSession || !restored) {
    log('Seeding fresh database...')
    pyodide.FS.writeFile(
      dbPath,
      await fetchBinary(fetchFn, `${storageEndpoint}/site1.db`),
    )
    await resetFreshSiteSetupState(pyodide, dbPath)
    logger.time('saveInitialStateToIDB')
    await stateStore.save(dbPath)
    logger.timeEnd('saveInitialStateToIDB')
  } else {
    logger.time('repairCompletedSiteDefaults')
    await repairCompletedSiteDefaults(pyodide, dbPath)
    logger.timeEnd('repairCompletedSiteDefaults')
  }
}
