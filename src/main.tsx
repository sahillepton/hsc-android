import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// Suppress harmless OpenGL warnings that occur during file operations
// These are Android rendering warnings that don't affect functionality
// const originalConsoleError = console.error;
// console.error = (...args: any[]) => {
//   const message = args.join(' ');
//   // Suppress OpenGL swap behavior warnings - these are harmless
//   if (message.includes('swap behavior') ||
//       message.includes('Unable to match the desired swap behavior') ||
//       (message.includes('OpenGLRenderer') && message.includes('Unable to match'))) {
//     // Silently ignore these warnings
//     return;
//   }
//   // Call original console.error for all other errors
//   originalConsoleError.apply(console, args);
// };

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
