// Replit Auth integration - from blueprint javascript_log_in_with_replit
import * as client from "openid-client";
import { Strategy, type VerifyFunction } from "openid-client/passport";

import passport from "passport";
import session from "express-session";
import type { Express, RequestHandler } from "express";
import memoize from "memoizee";
import connectPg from "connect-pg-simple";
import { storage } from "./storage";

// Check if we're in a Replit environment (only check essential vars)
export const isReplitEnvironment = () => {
  return Boolean(process.env.REPLIT_DOMAINS && process.env.REPL_ID);
};

// Check if external hosting bypass is explicitly enabled
export const isBypassEnabled = () => {
  return process.env.AUTH_BYPASS === "true";
};

if (!isReplitEnvironment()) {
  console.log("⚠️  Not in Replit environment - checking bypass mode");
  if (isBypassEnabled()) {
    console.log("🔓 AUTH_BYPASS enabled - using bypass authentication");
  } else {
    console.log("🔒 AUTH_BYPASS not set - external deployment will require authentication");
  }
}

const getOidcConfig = memoize(
  async () => {
    if (!isReplitEnvironment()) {
      throw new Error("Not in Replit environment");
    }
    return await client.discovery(
      new URL(process.env.ISSUER_URL ?? "https://replit.com/oidc"),
      process.env.REPL_ID!
    );
  },
  { maxAge: 3600 * 1000 }
);

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000; // 1 week
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET!,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: true,
      maxAge: sessionTtl,
    },
  });
}

function updateUserSession(
  user: any,
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers
) {
  user.claims = tokens.claims();
  user.access_token = tokens.access_token;
  user.refresh_token = tokens.refresh_token;
  user.expires_at = user.claims?.exp;
}

async function upsertUser(
  claims: any,
) {
  await storage.upsertUser({
    id: claims["sub"],
    email: claims["email"],
    firstName: claims["first_name"],
    lastName: claims["last_name"],
    profileImageUrl: claims["profile_image_url"],
  });
}

// Bypass middleware for explicitly enabled external hosting
export const bypassAuth: RequestHandler = async (req, res, next) => {
  if (!isBypassEnabled()) {
    return res.status(401).json({ 
      message: "Authentication required. Set AUTH_BYPASS=true or use proper authentication."
    });
  }

  // Create mock user and ensure it exists in storage
  const mockUser = {
    id: "external-user",
    email: "user@example.com", 
    firstName: "External",
    lastName: "User"
  };

  try {
    // Ensure the external user exists in storage
    await storage.upsertUser(mockUser);
  } catch (error) {
    console.error("Failed to create external user:", error);
  }

  req.user = {
    claims: {
      sub: mockUser.id,
      email: mockUser.email,
      first_name: mockUser.firstName,
      last_name: mockUser.lastName
    }
  };
  (req as any).isAuthenticated = () => true;
  next();
};

export async function setupAuth(app: Express) {
  // Only setup Replit auth if in Replit environment
  if (!isReplitEnvironment()) {
    console.log("ℹ️  Skipping Replit auth setup - not in Replit environment");
    return;
  }

  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  const config = await getOidcConfig();

  const verify: VerifyFunction = async (
    tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
    verified: passport.AuthenticateCallback
  ) => {
    const user = {};
    updateUserSession(user, tokens);
    await upsertUser(tokens.claims());
    verified(null, user);
  };

  for (const domain of process.env
    .REPLIT_DOMAINS!.split(",")) {
    const strategy = new Strategy(
      {
        name: `replitauth:${domain}`,
        config,
        scope: "openid email profile offline_access",
        callbackURL: `https://${domain}/api/callback`,
      },
      verify,
    );
    passport.use(strategy);
  }

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));

  app.get("/api/login", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      prompt: "login consent",
      scope: ["openid", "email", "profile", "offline_access"],
    })(req, res, next);
  });

  app.get("/api/callback", (req, res, next) => {
    passport.authenticate(`replitauth:${req.hostname}`, {
      successReturnToOrRedirect: "/",
      failureRedirect: "/api/login",
    })(req, res, next);
  });

  app.get("/api/logout", (req, res) => {
    req.logout(() => {
      res.redirect(
        client.buildEndSessionUrl(config, {
          client_id: process.env.REPL_ID!,
          post_logout_redirect_uri: `${req.protocol}://${req.hostname}`,
        }).href
      );
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // If not in Replit environment, use bypass auth (with explicit check)
  if (!isReplitEnvironment()) {
    return bypassAuth(req, res, next);
  }

  const user = req.user as any;

  if (!req.isAuthenticated() || !user.expires_at) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (now <= user.expires_at) {
    return next();
  }

  const refreshToken = user.refresh_token;
  if (!refreshToken) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const config = await getOidcConfig();
    const tokenResponse = await client.refreshTokenGrant(config, refreshToken);
    updateUserSession(user, tokenResponse);
    return next();
  } catch (error) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
};
