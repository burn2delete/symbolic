const stage = process.env.SST_STAGE || "dev"

export default {
  url: stage === "production" ? "https://symbolic.computer" : `https://${stage}.symbolic.computer`,
  console: stage === "production" ? "https://symbolic.computer/auth" : `https://${stage}.symbolic.computer/auth`,
  email: "contact@anoma.ly",
  socialCard: "https://social-cards.sst.dev",
  github: "https://github.com/SymbolicOS/symbolic",
  discord: "https://symbolic.computer/discord",
  headerLinks: [
    { name: "app.header.home", url: "/" },
    { name: "app.header.docs", url: "/docs/" },
  ],
}
