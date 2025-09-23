import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MapPin, Calendar, BarChart3, Users, Shield, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import PublicLayout from '@/components/PublicLayout';
import SEOHead from '@/components/SEOHead';

export default function LandingPage() {
  const features = [
    {
      icon: <MapPin className="h-8 w-8 text-primary" />,
      title: 'Interactive Maps',
      description: 'Visualize your travels on beautiful interactive maps with day-by-day navigation.'
    },
    {
      icon: <Calendar className="h-8 w-8 text-primary" />,
      title: 'Timeline View',
      description: 'Browse through your location history chronologically with detailed waypoint analysis.'
    },
    {
      icon: <BarChart3 className="h-8 w-8 text-primary" />,
      title: 'Travel Analytics',
      description: 'Get insights into your travel patterns, distance covered, and places visited.'
    },
    {
      icon: <Sparkles className="h-8 w-8 text-primary" />,
      title: 'AI Recommendations',
      description: 'Discover interesting places and hidden gems based on your travel history.'
    },
    {
      icon: <Shield className="h-8 w-8 text-primary" />,
      title: 'Privacy First',
      description: 'Your location data stays secure and private - stored locally and never shared.'
    },
    {
      icon: <Users className="h-8 w-8 text-primary" />,
      title: 'Admin Approval',
      description: 'Controlled access ensures only approved users can view and analyze location data.'
    }
  ];

  return (
    <PublicLayout>
      <SEOHead 
        title="WhereWasI? - Visualize Your Google Location History"
        description="Analyze and visualize your Google location history with interactive maps, travel analytics, and AI recommendations. Discover patterns in your travels and answer questions about your past journeys."
        ogTitle="WhereWasI - Location History Analysis App"
        ogDescription="Turn your Google location history into meaningful insights with beautiful maps, detailed analytics, and AI-powered recommendations."
      />
      
      {/* Hero Section */}
      <section className="py-16 md:py-24">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-4xl mx-auto">
            <h1 className="text-4xl md:text-6xl font-bold mb-6" data-testid="text-hero-title">
              Where<span className="text-primary">Was</span>I?
            </h1>
            <p className="text-xl md:text-2xl text-muted-foreground mb-4">
              "Where did we go last November?"
            </p>
            <p className="text-xl md:text-2xl text-muted-foreground mb-8">
              "How many days was I in Oregon in 2024?"
            </p>
            <p className="text-lg md:text-xl mb-12 max-w-2xl mx-auto">
              If you ever ask yourself these questions, this is your app! 
              WhereWasI helps you visualize your Google location history with beautiful maps and detailed analytics.
            </p>
            
            <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-12">
              <Link href="/login">
                <Button size="lg" className="text-lg px-8 py-6" data-testid="button-get-started">
                  Get Started Free
                </Button>
              </Link>
              <Link href="/how-it-works">
                <Button size="lg" variant="outline" className="text-lg px-8 py-6" data-testid="button-learn-more">
                  How it works
                </Button>
              </Link>
            </div>

            <div className="bg-muted/50 rounded-lg p-6 mb-16">
              <p className="text-sm text-muted-foreground mb-2">
                <strong>Early Access:</strong>
              </p>
              <p className="text-sm">
                You can set up an account for free, but until we officially launch, only approved users will have access.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Discover Your Travel Story</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Turn your Google location history into meaningful insights with our comprehensive analysis tools.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover-elevate" data-testid={`card-feature-${index}`}>
                <CardHeader>
                  <div className="mb-4">{feature.icon}</div>
                  <CardTitle>{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Questions Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">Questions We Answer</h2>
            <p className="text-lg text-muted-foreground">
              Curious about your travel patterns? We've got you covered.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-8 max-w-4xl mx-auto">
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"When was the last time I visited Portland?"</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"How many miles did I travel in 2023?"</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"What countries have I been to?"</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"Which cities do I visit most often?"</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"What interesting places did I miss?"</p>
              </div>
              <div className="p-4 rounded-lg bg-muted/50">
                <p className="font-medium text-primary">"Where did we go on our anniversary trip?"</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-4">Ready to Explore Your Journey?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Start analyzing your location history today and discover patterns you never knew existed.
            </p>
            <Link href="/login">
              <Button size="lg" className="text-lg px-8 py-6" data-testid="button-cta-signup">
                Sign Up for Early Access
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}