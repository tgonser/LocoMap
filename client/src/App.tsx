import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/ThemeProvider";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LogIn, MapPin } from "lucide-react";
import LocationHistoryApp from "@/components/LocationHistoryApp";
import ThemeToggle from "@/components/ThemeToggle";

function AuthenticatedApp() {
  const { user, logout } = useAuth();
  
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
      <main>
        <LocationHistoryApp />
      </main>
    </div>
  );
}

function LoginScreen() {
  const handleLogin = () => {
    window.location.href = '/auth/login';
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
          <Button 
            onClick={handleLogin} 
            className="w-full" 
            size="lg"
            data-testid="button-login"
          >
            <LogIn className="mr-2 h-4 w-4" />
            Sign in with Replit
          </Button>
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

  return user ? <AuthenticatedApp /> : <LoginScreen />;
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
