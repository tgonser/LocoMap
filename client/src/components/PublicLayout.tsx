import { MapPin, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link, useLocation } from 'wouter';
import { useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

interface PublicLayoutProps {
  children: React.ReactNode;
}

export default function PublicLayout({ children }: PublicLayoutProps) {
  const [location] = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navigation = [
    { name: 'How it works', href: '/how-it-works' },
    { name: 'Technology', href: '/technology' },
    { name: 'Contact Us', href: '/contact' },
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card/50 backdrop-blur sticky top-0 z-50">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Logo */}
            <Link href="/">
              <div className="flex items-center gap-2 hover-elevate rounded-lg p-2 -m-2 cursor-pointer" data-testid="link-home">
                <MapPin className="h-6 w-6 text-primary" />
                <h1 className="text-xl font-bold">WhereWasI?</h1>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center gap-6">
              {navigation.map((item) => (
                <Link key={item.name} href={item.href}>
                  <Button 
                    variant="ghost" 
                    className={location === item.href ? 'bg-muted' : ''}
                    data-testid={`link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                  >
                    {item.name}
                  </Button>
                </Link>
              ))}
              <Link href="/login">
                <Button data-testid="link-login">Login</Button>
              </Link>
              <ThemeToggle />
            </nav>

            {/* Mobile Menu Button */}
            <div className="flex items-center gap-2 md:hidden">
              <ThemeToggle />
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                data-testid="button-mobile-menu"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Mobile Navigation */}
          {mobileMenuOpen && (
            <nav className="md:hidden mt-4 pb-4 border-t pt-4">
              <div className="flex flex-col gap-2">
                {navigation.map((item) => (
                  <Link key={item.name} href={item.href}>
                    <Button 
                      variant="ghost" 
                      className={`w-full justify-start ${location === item.href ? 'bg-muted' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                      data-testid={`mobile-link-${item.name.toLowerCase().replace(/\s+/g, '-')}`}
                    >
                      {item.name}
                    </Button>
                  </Link>
                ))}
                <Link href="/login">
                  <Button className="w-full" onClick={() => setMobileMenuOpen(false)} data-testid="mobile-link-login">
                    Login
                  </Button>
                </Link>
              </div>
            </nav>
          )}
        </div>
      </header>

      <main>{children}</main>

      <footer className="border-t bg-card/20 mt-16">
        <div className="container mx-auto px-4 py-8">
          <div className="text-center text-muted-foreground">
            <p className="text-sm">
              © 2024 WhereWasI? - Visualize your location history with privacy and security.
            </p>
            <p className="text-xs mt-2">
              Your location data is stored securely and never shared with third parties.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}