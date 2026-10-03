/** AWS Price List API uses human-readable location names, not region codes. */
export const AWS_PRICE_LIST_LOCATION: Record<string, string> = {
  "us-east-1": "US East (N. Virginia)",
  "us-east-2": "US East (Ohio)",
  "us-west-2": "US West (Oregon)",
  "eu-west-1": "Europe (Ireland)",
  "eu-central-1": "Europe (Frankfurt)",
  "ap-south-1": "Asia Pacific (Mumbai)",
  "ap-south-2": "Asia Pacific (Hyderabad)",
};

export function awsPriceListLocation(regionCode: string): string {
  return AWS_PRICE_LIST_LOCATION[regionCode] ?? AWS_PRICE_LIST_LOCATION["us-east-1"];
}
