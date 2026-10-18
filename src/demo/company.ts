import company from "../../demo/content/company.json";

/**
 * The fictional demo company. Its documents live in demo/content (Markdown) and demo/files (rendered); the
 * seed loads them into a template company that every visitor's sandbox reads.
 */
export const demoCompany = {
  name: company.name,
  slug: company.slug,
  community: company.community,
  city: `${company.city}, ${company.state}`,
  domain: company.email.split("@")[1]!,
};

/**
 * Fixed accounts of the template company itself (seeded; local password fixed, cloud password from the
 * environment). Public visitors never use them: each gets a private sandbox instead.
 */
export const templateAccounts = {
  admin: { email: `manager@${demoCompany.domain}`, displayName: "Dana Whitfield", role: "admin" },
  member: { email: `resident@${demoCompany.domain}`, displayName: "Jordan Ellis", role: "member" },
} as const;

export const localDemoPassword = "ostervale-local-demo";
