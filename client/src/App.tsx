import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LogIn, MapPin, UserPlus, User, Eye, EyeOff, AlertCircle, Shield } from "lucide-react";
import LocationHistoryApp from "@/components/LocationHistoryApp";
import AdminPanel from "@/pages/AdminPanel";
import LandingPage from "@/pages/LandingPage";
import HowItWorksPage from "@/pages/HowItWorksPage";
import ContactPage from "@/pages/ContactPage";
import NotFound from "@/pages/not-found";
import ThemeToggle from "@/components/ThemeToggle";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Switch, Route, useLocation } from "wouter";

function PendingApprovalScreen({ user, logout }: { user: any, logout: () => void }) {
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-semibold">Location History Analyzer</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.first_name || user?.email || 'User'}
            </span>
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout">
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main className="flex items-center justify-center min-h-[calc(100vh-80px)]">
        <Card className="w-full max-w-md mx-4">
          <CardHeader className="text-center">
            <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-yellow-100 flex items-center justify-center">
              <AlertCircle className="h-6 w-6 text-yellow-600" />
            </div>
            <CardTitle>Account Pending Approval</CardTitle>
            <CardDescription>
              Your account registration is being reviewed by an administrator
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-sm text-muted-foreground">
              Thank you for registering! Your account request has been submitted and is awaiting admin approval. 
              You'll be able to access the application once your account is approved.
            </p>
            <div className="p-4 bg-muted rounded-lg">
              <p className="text-sm font-medium mb-2">Account Details:</p>
              <p className="text-sm text-muted-foreground">Email: {user?.email}</p>
              <p className="text-sm text-muted-foreground">Status: {user?.approvalStatus || 'Pending'}</p>
            </div>
            <p className="text-xs text-muted-foreground">
              Please contact the administrator if you have any questions about your account status.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  const [currentView, setCurrentView] = useState<'app' | 'admin'>('app');
  
  // Check if user is admin
  const isAdmin = user?.role === 'admin';
  
  // Check if user is approved (admin users are always approved)
  const isApproved = user?.isApproved === true || isAdmin;
  
  // If user is not approved, show pending approval screen
  if (!isApproved) {
    return <PendingApprovalScreen user={user} logout={logout} />;
  }
  
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MapPin className="h-6 w-6 text-primary" />
            <h1 className="text-lg font-semibold">Location History Analyzer</h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              Welcome, {user?.first_name || user?.email || 'User'}
            </span>
            {isAdmin && (
              <>
                <Button 
                  variant={currentView === 'admin' ? 'default' : 'outline'} 
                  size="sm" 
                  onClick={() => setCurrentView(currentView === 'admin' ? 'app' : 'admin')}
                  className="gap-2"
                  data-testid="button-admin-panel"
                >
                  <Shield className="h-4 w-4" />
                  {currentView === 'admin' ? 'Back to App' : 'Admin Panel'}
                </Button>
              </>
            )}
            <ThemeToggle />
            <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout">
              Logout
            </Button>
          </div>
        </div>
      </header>
      <main>
        {currentView === 'admin' ? <AdminPanel /> : <LocationHistoryApp />}
      </main>
    </div>
  );
}

function LoginScreen() {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    firstName: '',
    lastName: '',
  });
  const { toast } = useToast();

  // Password validation
  const passwordRequirements = [
    { text: 'At least 8 characters', met: formData.password.length >= 8 },
    { text: 'Contains uppercase letter', met: /[A-Z]/.test(formData.password) },
    { text: 'Contains lowercase letter', met: /[a-z]/.test(formData.password) },
    { text: 'Contains number', met: /\d/.test(formData.password) },
  ];
  const isPasswordValid = passwordRequirements.every(req => req.met);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      const url = isLogin ? '/api/auth/login' : '/api/auth/register';
      // Validate password for registration
      if (!isLogin && !isPasswordValid) {
        throw new Error('Password does not meet requirements');
      }

      const body = isLogin 
        ? { username: formData.username, password: formData.password }
        : formData;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || `${isLogin ? 'Login' : 'Registration'} failed`);
      }

      // Store token and refresh the page to update auth state
      localStorage.setItem('authToken', data.token);
      window.location.reload();

    } catch (error) {
      toast({
        title: isLogin ? "Login Failed" : "Registration Failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <MapPin className="h-6 w-6 text-primary" />
          </div>
          <CardTitle className="text-2xl">Location History Analyzer</CardTitle>
          <CardDescription>
            Analyze and visualize your Google location history data with interactive maps and detailed analytics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleInputChange}
                required
                data-testid="input-username"
              />
            </div>

            {!isLogin && (
              <>
                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    value={formData.email}
                    onChange={handleInputChange}
                    required
                    data-testid="input-email"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      name="firstName"
                      type="text"
                      value={formData.firstName}
                      onChange={handleInputChange}
                      data-testid="input-firstname"
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      name="lastName"
                      type="text"
                      value={formData.lastName}
                      onChange={handleInputChange}
                      data-testid="input-lastname"
                    />
                  </div>
                </div>
              </>
            )}

            <div>
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  className={!isLogin && formData.password && !isPasswordValid ? "border-destructive" : ""}
                  data-testid="input-password"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                  data-testid="button-toggle-password"
                >
                  {showPassword ? (
                    <EyeOff className="h-4 w-4" />
                  ) : (
                    <Eye className="h-4 w-4" />
                  )}
                </Button>
              </div>
              {!isLogin && formData.password && (
                <div className="mt-2 space-y-1">
                  {passwordRequirements.map((req, index) => (
                    <div key={index} className="flex items-center text-xs">
                      <AlertCircle className={`h-3 w-3 mr-1 ${
                        req.met ? 'text-green-500' : 'text-muted-foreground'
                      }`} />
                      <span className={req.met ? 'text-green-500' : 'text-muted-foreground'}>
                        {req.text}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <Button 
              type="submit"
              className="w-full" 
              size="lg"
              disabled={loading}
              data-testid={isLogin ? "button-login" : "button-register"}
            >
              {loading ? (
                "Loading..."
              ) : isLogin ? (
                <>
                  <LogIn className="mr-2 h-4 w-4" />
                  Sign In
                </>
              ) : (
                <>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Sign Up
                </>
              )}
            </Button>
          </form>

          <div className="mt-4 text-center space-y-2">
            <Button
              variant="ghost"
              onClick={() => setIsLogin(!isLogin)}
              data-testid="button-toggle-mode"
            >
              {isLogin ? "Need an account? Sign up" : "Already have an account? Sign in"}
            </Button>
            
            {isLogin && (
              <div>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => setShowForgotPassword(!showForgotPassword)}
                  data-testid="button-forgot-password"
                  className="text-xs"
                >
                  Forgot your password?
                </Button>
              </div>
            )}
            
            {showForgotPassword && (
              <div className="text-left p-4 bg-muted rounded-lg text-sm">
                <h4 className="font-medium mb-2">Reset Your Password</h4>
                <p className="text-muted-foreground mb-3">
                  Since this is a self-hosted application, password resets need to be handled manually.
                </p>
                <div className="space-y-2 text-xs">
                  <p><strong>Option 1:</strong> Contact your administrator if this is deployed by someone else.</p>
                  <p><strong>Option 2:</strong> If you deployed this yourself, you can create a new account or reset via the database.</p>
                  <p><strong>Option 3:</strong> Redeploy the application to start fresh (all data will be lost).</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowForgotPassword(false)}
                  className="mt-2 text-xs"
                >
                  Close
                </Button>
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground text-center mt-4">
            Your location data is stored securely and never shared
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function AppContent() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <Switch>
      {/* Public routes - handle both with and without trailing slashes */}
      <Route path="/" component={LandingPage} />
      <Route path="/how-it-works" component={HowItWorksPage} />
      <Route path="/how-it-works/" component={HowItWorksPage} />
      <Route path="/contact" component={ContactPage} />
      <Route path="/contact/" component={ContactPage} />
      
      {/* Login route */}
      <Route path="/login" component={LoginScreen} />
      <Route path="/login/" component={LoginScreen} />
      
      {/* 404 page for unknown public routes */}
      <Route path="/404" component={NotFound} />
      
      {/* Authenticated routes - check if user is logged in for app routes */}
      <Route path="/app/:rest*">
        {user ? <AuthenticatedApp /> : <LoginScreen />}
      </Route>
      
      {/* Catch all unknown routes - redirect to 404 for public, login for app */}
      <Route>
        <NotFound />
      </Route>
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <AppContent />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
