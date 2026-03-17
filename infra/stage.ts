export const domain = (() => {
  if ($app.stage === "production") return "symbolic.computer"
  if ($app.stage === "dev") return "dev.symbolic.computer"
  return `${$app.stage}.dev.symbolic.computer`
})()

export const zoneID = "430ba34c138cfb5360826c4909f99be8"

new cloudflare.RegionalHostname("RegionalHostname", {
  hostname: domain,
  regionKey: "us",
  zoneId: zoneID,
})

export const shortDomain = (() => {
  if ($app.stage === "production") return "symbolic.computer"
  if ($app.stage === "dev") return "dev.symbolic.computer"
  return `${$app.stage}.dev.symbolic.computer`
})()
