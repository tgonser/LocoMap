import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Mail, MessageSquare, Send, CheckCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import PublicLayout from '@/components/PublicLayout';
import SEOHead from '@/components/SEOHead';

const contactFormSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Please enter a valid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters'),
});

type ContactFormData = z.infer<typeof contactFormSchema>;

export default function ContactPage() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();
  
  const form = useForm<ContactFormData>({
    resolver: zodResolver(contactFormSchema),
    defaultValues: {
      name: '',
      email: '',
      message: '',
    },
  });

  const onSubmit = async (data: ContactFormData) => {
    try {
      // Since this is a demo, we'll just simulate the submission
      // In a real implementation, you'd send this to your backend
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setIsSubmitted(true);
      form.reset();
      
      toast({
        title: "Message Sent!",
        description: "Thank you for contacting us. We'll get back to you soon.",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: "There was a problem sending your message. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <PublicLayout>
      <SEOHead 
        title="Contact Us - WhereWasI?"
        description="Get in touch with WhereWasI support. Contact us for help with your account, technical support, or feature requests."
        ogTitle="Contact WhereWasI - Location History Analysis App"
        ogDescription="Need help with location history analysis? Contact our support team for assistance with uploads, visualization, or account issues."
      />
      
      {/* Header */}
      <section className="py-16">
        <div className="container mx-auto px-4 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-6" data-testid="text-page-title">
            Contact Us
          </h1>
          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto">
            Have questions about WhereWasI? Need help with your account? 
            We're here to help and would love to hear from you.
          </p>
        </div>
      </section>

      {/* Contact Form */}
      <section className="py-16">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            {isSubmitted ? (
              <Card className="text-center">
                <CardHeader>
                  <div className="mx-auto w-16 h-16 bg-green-100 dark:bg-green-900/20 rounded-full flex items-center justify-center mb-4">
                    <CheckCircle className="h-8 w-8 text-green-600" />
                  </div>
                  <CardTitle className="text-2xl">Message Sent!</CardTitle>
                  <CardDescription>
                    Thank you for contacting us. We'll get back to you as soon as possible.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button 
                    onClick={() => setIsSubmitted(false)}
                    variant="outline"
                    data-testid="button-send-another"
                  >
                    Send Another Message
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
                      <MessageSquare className="h-6 w-6 text-primary" />
                    </div>
                    <div>
                      <CardTitle className="text-2xl">Get in Touch</CardTitle>
                      <CardDescription>
                        Send us a message and we'll respond promptly
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Form {...form}>
                    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                      <div className="grid md:grid-cols-2 gap-4">
                        <FormField
                          control={form.control}
                          name="name"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Name *</FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Your full name"
                                  data-testid="input-name"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="email"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Email *</FormLabel>
                              <FormControl>
                                <Input
                                  type="email"
                                  placeholder="your.email@example.com"
                                  data-testid="input-email"
                                  {...field}
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                      
                      <FormField
                        control={form.control}
                        name="message"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Message *</FormLabel>
                            <FormControl>
                              <Textarea
                                placeholder="Tell us how we can help you..."
                                rows={6}
                                data-testid="input-message"
                                {...field}
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <Button 
                        type="submit" 
                        size="lg" 
                        className="w-full"
                        disabled={form.formState.isSubmitting}
                        data-testid="button-submit"
                      >
                        {form.formState.isSubmitting ? (
                          "Sending..."
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            Send Message
                          </>
                        )}
                      </Button>
                    </form>
                  </Form>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* Additional Info */}
      <section className="py-16 bg-muted/20">
        <div className="container mx-auto px-4">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-12">
              <h2 className="text-2xl font-bold mb-4">Other Ways to Reach Us</h2>
              <p className="text-muted-foreground">
                Looking for specific information? Here are some common topics we can help with.
              </p>
            </div>
            
            <div className="grid md:grid-cols-3 gap-6">
              <Card className="hover-elevate">
                <CardHeader>
                  <Mail className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Technical Support</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    Having trouble uploading your location data or using the app? 
                    We're here to help with any technical issues.
                  </CardDescription>
                </CardContent>
              </Card>
              
              <Card className="hover-elevate">
                <CardHeader>
                  <MessageSquare className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Account Access</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    Need approval for your account or having login issues? 
                    Contact us for account-related assistance.
                  </CardDescription>
                </CardContent>
              </Card>
              
              <Card className="hover-elevate">
                <CardHeader>
                  <CheckCircle className="h-8 w-8 text-primary mb-2" />
                  <CardTitle className="text-lg">Feature Requests</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription className="text-sm">
                    Have ideas for new features or improvements? 
                    We'd love to hear your suggestions for making WhereWasI better.
                  </CardDescription>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      </section>

      {/* Privacy Note */}
      <section className="py-12">
        <div className="container mx-auto px-4">
          <div className="max-w-2xl mx-auto text-center">
            <div className="bg-muted/50 rounded-lg p-6">
              <h3 className="font-semibold mb-2">Privacy Notice</h3>
              <p className="text-sm text-muted-foreground">
                Any information you provide through this contact form is used solely for responding to your inquiry. 
                We never share your contact details with third parties or use them for marketing purposes.
              </p>
            </div>
          </div>
        </div>
      </section>
    </PublicLayout>
  );
}