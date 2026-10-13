import { localPaths } from '../server/local-paths.mjs';
import { createStore } from '../server/store.mjs';
const paths = localPaths();
const store = createStore(paths.database);
try {
  store.snapshot();
} finally {
  store.close();
}
console.log(`База: ${paths.database}\nМодели: ${paths.support}`);
