// Web Storage wrapper that never throws: storage can be disabled, blocked or full.
// `getStorage` is a function because merely reading `window.localStorage` can throw.
export function createStore(getStorage) {
  return {
    get(key) {
      try {
        return getStorage().getItem(key);
      } catch {
        return null;
      }
    },
    // Returns true only when the value was actually written.
    set(key, value) {
      try {
        getStorage().setItem(key, value);
        return true;
      } catch {
        return false;
      }
    },
  };
}
