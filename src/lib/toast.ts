// Simple toast notification system
type ToastType = "loading" | "success" | "error";

let toastContainer: HTMLDivElement | null = null;
let currentToastId: string | null = null;

const createToastContainer = () => {
  if (toastContainer) return toastContainer;

  toastContainer = document.createElement("div");
  toastContainer.id = "toast-container";
  toastContainer.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9999;
    pointer-events: none;
  `;
  document.body.appendChild(toastContainer);
  return toastContainer;
};

const getToastStyles = () => {
  return {
    padding: "6px 10px",
    borderRadius: "8px",
    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)",
    backgroundColor: "white",
    color: "black",
    fontSize: "14px",
    fontWeight: "400",
    maxWidth: "400px",
    textAlign: "left",
    pointerEvents: "auto",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    border: "1px solid #e5e7eb",
  };
};

const createIcon = (type: ToastType): string => {
  switch (type) {
    case "loading":
      return `<svg width="20" height="20" viewBox="0 0 80 80" xmlns="http://www.w3.org/2000/svg"><style><![CDATA[.loader-bg{fill:none;stroke:#e5e7eb;stroke-width:4}.loader-ring{fill:none;stroke:#4f46e5;stroke-width:4;stroke-linecap:round;stroke-dasharray:60 188;transform-origin:50% 50%;animation:spin 1.1s linear infinite}.offline-icon{stroke:#374151;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}.offline-x{stroke:#ef4444;stroke-width:2;stroke-linecap:round}.offline-text{font-size:8px;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;fill:#4b5563}@keyframes spin{0%{stroke-dashoffset:0;transform:rotate(0deg)}100%{stroke-dashoffset:-248;transform:rotate(360deg)}}]]></style><circle class="loader-bg" cx="40" cy="40" r="26"/><circle class="loader-ring" cx="40" cy="40" r="26"/></svg>`;
    case "success":
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #10b981; flex-shrink: 0;" class="toast-icon"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`;
    case "error":
      return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: #ef4444; flex-shrink: 0;" class="toast-icon"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6M9 9l6 6"/></svg>`;
  }
};

export const toast = {
  loading: (message: string): string => {
    const id = Math.random().toString(36).substring(7);
    const container = createToastContainer();

    // Remove existing toast
    if (currentToastId) {
      const existing = container.querySelector(
        `[data-toast-id="${currentToastId}"]`
      );
      if (existing) existing.remove();
    }

    const toastEl = document.createElement("div");
    toastEl.setAttribute("data-toast-id", id);
    const styles = getToastStyles();
    Object.assign(toastEl.style, styles);

    toastEl.innerHTML = `
      ${createIcon("loading")}
      <span style="flex: 1; color: black;">${message}</span>
    `;

    // Add spin animation
    const style = document.createElement("style");
    style.textContent = `
      @keyframes spin {
        to { transform: rotate(360deg); }
      }
      .toast-icon {
        flex-shrink: 0;
      }
    `;
    if (!document.head.querySelector("#toast-spin-style")) {
      style.id = "toast-spin-style";
      document.head.appendChild(style);
    }

    container.appendChild(toastEl);
    currentToastId = id;
    return id;
  },

  success: (message: string): string => {
    const id = Math.random().toString(36).substring(7);
    const container = createToastContainer();

    // Remove existing toast
    if (currentToastId) {
      const existing = container.querySelector(
        `[data-toast-id="${currentToastId}"]`
      );
      if (existing) existing.remove();
    }

    const toastEl = document.createElement("div");
    toastEl.setAttribute("data-toast-id", id);
    const styles = getToastStyles();
    Object.assign(toastEl.style, styles);

    toastEl.innerHTML = `
      ${createIcon("success")}
      <span style="flex: 1; color: black;">${message}</span>
    `;

    container.appendChild(toastEl);
    currentToastId = id;

    // Auto dismiss after 3 seconds
    setTimeout(() => {
      toastEl.style.opacity = "0";
      toastEl.style.transition = "opacity 0.3s";
      setTimeout(() => {
        if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        if (currentToastId === id) currentToastId = null;
      }, 300);
    }, 3000);

    return id;
  },

  error: (message: string): string => {
    const id = Math.random().toString(36).substring(7);
    const container = createToastContainer();

    // Remove existing toast
    if (currentToastId) {
      const existing = container.querySelector(
        `[data-toast-id="${currentToastId}"]`
      );
      if (existing) existing.remove();
    }

    const toastEl = document.createElement("div");
    toastEl.setAttribute("data-toast-id", id);
    const styles = getToastStyles();
    Object.assign(toastEl.style, styles);

    toastEl.innerHTML = `
      ${createIcon("error")}
      <span style="flex: 1; color: black;">${message}</span>
    `;

    container.appendChild(toastEl);
    currentToastId = id;

    // Auto dismiss after 5 seconds
    setTimeout(() => {
      toastEl.style.opacity = "0";
      toastEl.style.transition = "opacity 0.3s";
      setTimeout(() => {
        if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        if (currentToastId === id) currentToastId = null;
      }, 300);
    }, 5000);

    return id;
  },

  dismiss: (id: string) => {
    if (!toastContainer) return;
    const toastEl = toastContainer.querySelector(`[data-toast-id="${id}"]`);
    if (toastEl) {
      (toastEl as HTMLElement).style.opacity = "0";
      (toastEl as HTMLElement).style.transition = "opacity 0.3s";
      setTimeout(() => {
        if (toastEl.parentNode) toastEl.parentNode.removeChild(toastEl);
        if (currentToastId === id) currentToastId = null;
      }, 300);
    }
  },

  update: (id: string, message: string, type?: ToastType) => {
    if (!toastContainer) {
      // If container doesn't exist, create it
      createToastContainer();
    }
    const toastEl = toastContainer?.querySelector(
      `[data-toast-id="${id}"]`
    ) as HTMLElement;
    if (toastEl) {
      const styles = getToastStyles();
      Object.assign(toastEl.style, styles);
      // Ensure toast is visible
      toastEl.style.opacity = "1";
      toastEl.style.transition = "opacity 0.3s";

      if (type === "loading") {
        toastEl.innerHTML = `
          ${createIcon("loading")}
          <span style="flex: 1; color: black;">${message}</span>
        `;
      } else if (type === "success") {
        toastEl.innerHTML = `
          ${createIcon("success")}
          <span style="flex: 1; color: black;">${message}</span>
        `;
        // Clear any existing dismiss timeout and set a new one
        const existingTimeout = (toastEl as any).__dismissTimeout;
        if (existingTimeout) clearTimeout(existingTimeout);
        (toastEl as any).__dismissTimeout = setTimeout(
          () => toast.dismiss(id),
          3000
        );
      } else if (type === "error") {
        toastEl.innerHTML = `
          ${createIcon("error")}
          <span style="flex: 1; color: black;">${message}</span>
        `;
        // Clear any existing dismiss timeout and set a new one
        const existingTimeout = (toastEl as any).__dismissTimeout;
        if (existingTimeout) clearTimeout(existingTimeout);
        (toastEl as any).__dismissTimeout = setTimeout(
          () => toast.dismiss(id),
          5000
        );
      }
    } else {
      // If toast element doesn't exist, create a new one instead
      if (type === "success") {
        toast.success(message);
      } else if (type === "error") {
        toast.error(message);
      } else {
        toast.loading(message);
      }
    }
  },
};
