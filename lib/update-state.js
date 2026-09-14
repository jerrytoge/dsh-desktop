'use strict';

// Update state that survives for the whole app lifetime.
//
// The app used to check for updates exactly once, during boot. A window left
// open for days therefore never noticed a release that appeared afterwards, and
// the only entry point was a modal dialog that could be dismissed and lost.
//
// This tracker is pure logic: no Electron, no timers, no network. main.js owns
// the timer, the menu and the dialogs; this decides *when* to check, *what* the
// persistent entry should say, and *whether* the user still needs a dialog.

const HOUR_MS = 3600 * 1000;

function freshState() {
  return {
    status: 'idle', // idle | checking | current | available | error
    current: null,
    latest: null,
    hasUpdate: false,
    lastCheckedAt: 0,
    notifiedVersion: null,
    info: null,
  };
}

function createUpdateTracker({ intervalMs = 6 * HOUR_MS } = {}) {
  let state = freshState();

  return {
    get state() {
      return { ...state };
    },
    get intervalMs() {
      return intervalMs;
    },

    // A tracker that has never completed a check is always due, which makes the
    // first (boot) check fall out of the same code path as the periodic ones.
    isDue(now = Date.now()) {
      if (!state.lastCheckedAt) return true;
      return now - state.lastCheckedAt >= intervalMs;
    },

    markChecking() {
      state = { ...state, status: 'checking' };
    },

    // Records a finished check; `info` is null when the check itself failed.
    // Returns what the caller should do next.
    record(info, now = Date.now()) {
      const previous = state;

      if (!info) {
        // A failed periodic check must not erase a known-good result, otherwise
        // a transient network error would hide an available update again.
        state = { ...state, status: previous.hasUpdate ? 'available' : 'error', lastCheckedAt: now };
        return { shouldPrompt: false, becameAvailable: false };
      }

      const hasUpdate = Boolean(info.hasUpdate);
      const latest = info.latest || previous.latest;
      state = {
        status: hasUpdate ? 'available' : 'current',
        current: info.current || previous.current,
        latest,
        hasUpdate,
        lastCheckedAt: now,
        notifiedVersion: previous.notifiedVersion,
        info,
      };

      return {
        // At most one dialog per version, so a periodic check cannot nag.
        shouldPrompt: hasUpdate && state.notifiedVersion !== latest,
        becameAvailable: hasUpdate && previous.latest !== latest,
      };
    },

    markNotified() {
      state = { ...state, notifiedVersion: state.latest };
    },

    // What an explicit click on the update entry should do.
    //
    // This is the difference between a signal and an action. Clicking used to
    // always re-run the check, and because a version is only announced once,
    // `shouldPrompt` was already false — so the click flipped the label to
    // "正在检查更新…" and then silently did nothing at all.
    //
    // 'update' — a release is already known: act on it, do not re-check.
    // 'wait'   — a check is in flight.
    // 'check'  — nothing known yet: go and look.
    clickAction() {
      if (state.hasUpdate && state.info) return 'update';
      if (state.status === 'checking') return 'wait';
      return 'check';
    },

    // Text for the always-present application-menu entry.
    menuLabel() {
      if (state.status === 'checking') return '正在检查更新…';
      if (state.hasUpdate && state.latest) return `有新版本 ${state.latest}…`;
      return '检查更新…';
    },

    // Dock badge: a passive signal that survives dismissing the dialog.
    badge() {
      return state.hasUpdate ? '●' : '';
    },
  };
}

module.exports = { HOUR_MS, createUpdateTracker };
