import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, Upload, Eye, BarChart3, Smartphone, MapPin, FileText, Sparkles } from 'lucide-react';
import { Link } from 'wouter';
import PublicLayout from '@/components/PublicLayout';
import SEOHead from '@/components/SEOHead';

export default function HowItWorksPage() {
  const steps = [
    {
      number: '1',
      icon: <Smartphone className="h-8 w-8 text-primary" />,
      title: 'Export Your Google Location History (Mobile Only)',
      description: 'Export your location data directly from your mobile device using the Google Maps app. This must be done on iOS or Android - desktop export is no longer available.',
      details: [
        'iOS: Open Google Maps app → Profile picture → "Your Timeline" → "..." → "Location and privacy settings" → "Export Timeline Data"',
        'Android: Settings app → Location → Location services → Timeline → "Export Timeline data"',
        'Save the Timeline.json file to your preferred storage location (Files, Google Drive, etc.)',
        'Transfer the file to your computer if needed for upload'
      ]
    },
    {
      number: '2',
      icon: <Upload className="h-8 w-8 text-primary" />,
      title: 'Upload to WhereWasI',
      description: 'Simply drag and drop your JSON file into our secure upload area. Your data stays private and is processed locally.',
      details: [
        'Drag your JSON file to the upload area',
        'Files are processed securely on our servers',
        'No data is shared with third parties',
        'Processing typically takes 30-60 seconds'
      ]
    },
    {
      number: '3',
      icon: <Eye className="h-8 w-8 text-primary" />,
      title: 'Explore Your Journey',
      description: 'Navigate through your location history with beautiful interactive maps and detailed timeline views.',
      details: [
        'Day-by-day map visualization',
        'Timeline view with waypoint details',
        'Search by date or location',
        'Zoom and pan through your travels'
      ]
    },
    {
      number: '4',
      icon: <BarChart3 className="h-8 w-8 text-primary" />,
      title: 'Analyze Your Patterns',
      description: 'Get insights into your travel habits, discover new patterns, and answer questions about your past journeys.',
      details: [
        'Travel distance and time analytics',
        'Most visited places and routes',
        'Country and city breakdowns',
        'Yearly and monthly summaries'
      ]
    }
  ];

  const features = [
    {
      icon: <MapPin className="h-6 w-6 text-primary" />,
      title: 'Interactive Maps',
      description: 'Visualize your exact routes and stops on detailed maps with clustering and smooth navigation.'
    },
    {
      icon: <FileText className="h-6 w-6 text-primary" />,
      title: 'Timeline Analysis',
      description: 'Browse chronologically through your location history with detailed waypoint information.'
    },
    {
      icon: <BarChart3 className="h-6 w-6 text-primary" />,
      title: 'Travel Statistics',
      description: 'Comprehensive analytics showing distances, time spent, and travel patterns over time.'
    },
    {
      icon: <Sparkles className="h-6 w-6 text-primary" />,
      title: 'AI Recommendations',
      description: 'Get personalized suggestions for interesting places you might have missed along your routes.'
    }
  ];

  return (
    <PublicLayout>
      <SEOHead 
        title="How It Works - WhereWasI? Location History Analysis"
        description="Learn how to export your Google location history and analyze it with WhereWasI. Step-by-step guide to visualizing your travels with interactive maps and analytics."
        ogTitle="How WhereWasI Works - Location History Analysis Guide"
        ogDescription="Step-by-step guide: Export Google location data, upload to WhereWasI, and explore your travels with interactive maps and detailed analytics."
      />
      
      {/* Header */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-6" data-testid="text-page-title">
            How It Works
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-3xl mx-auto">
            Transform your Google location history into meaningful insights with our simple 4-step process. 
            From data export to visualization, we make it easy to explore your travel story.
          </p>
        </div>
      </section>

      {/* Steps */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="space-y-16">
            {steps.map((step, index) => (
              <div 
                key={index} 
                className={`grid md:grid-cols-2 gap-8 items-center ${index % 2 === 1 ? 'md:grid-flow-dense' : ''}`}
                data-testid={`step-${step.number}`}
              >
                <div className={index % 2 === 1 ? 'md:col-start-2' : ''}>
                  <div className="flex items-center gap-4 mb-6">
                    <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-xl font-bold text-primary">
                      {step.number}
                    </div>
                    <div>{step.icon}</div>
                  </div>
                  <h3 className="text-2xl font-bold mb-4">{step.title}</h3>
                  <p className="text-lg text-muted-foreground mb-6">{step.description}</p>
                  <ul className="space-y-2">
                    {step.details.map((detail, detailIndex) => (
                      <li key={detailIndex} className="flex items-start gap-2">
                        <div className="w-2 h-2 rounded-full bg-primary mt-2 flex-shrink-0"></div>
                        <span className="text-sm">{detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`bg-muted/20 rounded-lg p-8 ${index % 2 === 1 ? 'md:col-start-1' : ''}`}>
                  <div className="text-center">
                    <div className="w-20 h-20 mx-auto mb-4 bg-primary/10 rounded-full flex items-center justify-center">
                      {step.icon}
                    </div>
                    <h4 className="text-lg font-semibold mb-2">Step {step.number}</h4>
                    <p className="text-muted-foreground">{step.title}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features Overview */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What You Can Do</h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Once your data is uploaded, explore your location history with these powerful visualization tools.
            </p>
          </div>
          
          <div className="grid md:grid-cols-2 gap-6">
            {features.map((feature, index) => (
              <Card key={index} className="hover-elevate" data-testid={`feature-card-${index}`}>
                <CardHeader>
                  <div className="flex items-center gap-3">
                    {feature.icon}
                    <CardTitle className="text-lg">{feature.title}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent>
                  <CardDescription>{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Privacy Section */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <Card className="max-w-4xl mx-auto">
            <CardHeader className="text-center">
              <CardTitle className="text-2xl mb-2">Your Privacy Matters</CardTitle>
              <CardDescription>
                We take data security seriously. Here's how we protect your location information.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid md:grid-cols-3 gap-6 text-center">
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center">
                    <Download className="h-6 w-6 text-green-600" />
                  </div>
                  <h4 className="font-semibold mb-2">Secure Processing</h4>
                  <p className="text-sm text-muted-foreground">
                    Your data is processed securely and stored with encryption
                  </p>
                </div>
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-blue-100 dark:bg-blue-900/20 rounded-full flex items-center justify-center">
                    <Eye className="h-6 w-6 text-blue-600" />
                  </div>
                  <h4 className="font-semibold mb-2">No Sharing</h4>
                  <p className="text-sm text-muted-foreground">
                    Your location data is never shared with third parties
                  </p>
                </div>
                <div>
                  <div className="w-12 h-12 mx-auto mb-3 bg-purple-100 dark:bg-purple-900/20 rounded-full flex items-center justify-center">
                    <MapPin className="h-6 w-6 text-purple-600" />
                  </div>
                  <h4 className="font-semibold mb-2">Your Control</h4>
                  <p className="text-sm text-muted-foreground">
                    You can delete your data at any time from your account
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 bg-primary/5">
        <div className="container mx-auto px-4 text-center">
          <div className="max-w-2xl mx-auto">
            <h2 className="text-3xl font-bold mb-4">Ready to Get Started?</h2>
            <p className="text-lg text-muted-foreground mb-8">
              Upload your Google location history and start exploring your travel story today.
            </p>
            <Link href="/login">
              <Button size="lg" className="text-lg px-8 py-6" data-testid="button-cta-start">
                Start Analyzing Your Data
              </Button>
            </Link>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}