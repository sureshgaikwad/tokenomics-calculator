export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startBackgroundPricingRefresh } = await import("@tokenomics/tco-core");
    startBackgroundPricingRefresh();
  }
}
