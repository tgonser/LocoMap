// Simple visitor tracking utility

interface TrackVisitOptions {
  path?: string;
  referrer?: string;
}

// Track a page visit
export async function trackPageVisit(options: TrackVisitOptions = {}) {
  try {
    const path = options.path || window.location.pathname;
    const referrer = options.referrer || document.referrer || undefined;

    await fetch('/api/track/visit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        path,
        referrer,
      }),
    });
  } catch (error) {
    // Silently fail - don't disrupt user experience for tracking failures
    console.debug('Failed to track page visit:', error);
  }
}

// Hook to track page visits automatically
export function usePageTracking() {
  const trackVisit = (path?: string) => {
    trackPageVisit({ path });
  };

  return { trackVisit };
}

// Track on initial page load (call once in App component)
export function trackInitialPageLoad() {
  // Wait a moment to ensure page is fully loaded
  setTimeout(() => {
    trackPageVisit();
  }, 100);
}