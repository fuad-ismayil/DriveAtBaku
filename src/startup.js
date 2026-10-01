import { loadingScreen } from './loadingScreen.js';

// Start the small, independent introduction before requesting the game module.
loadingScreen.begin();
import('./main.js').catch(error => {
  console.error('Game startup failed:', error);
  loadingScreen.fail(error);
});
