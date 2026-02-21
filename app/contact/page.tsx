import { Mail, MessageCircle, MapPin, Phone } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ContactPage() {
  return (
    <div className="bg-slate-50 min-h-screen py-8 md:py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-4xl md:text-5xl font-bold text-blue-900 mb-4">Get In Touch</h1>
          <p className="text-lg text-slate-600 max-w-2xl mx-auto">
            Have questions about CampusIntel? Need to submit resources or suggest improvements?
            We'd love to hear from you!
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-12 max-w-4xl mx-auto">
          {/* Contact Methods */}
          <div className="space-y-6">
            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="w-6 h-6 text-blue-900" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-2">WhatsApp</h3>
                  <p className="text-slate-600 text-sm mb-4">
                    Get instant responses and support. Send us a message anytime!
                  </p>
                  <a
                    href="https://wa.me/2349018750976"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Button className="bg-green-600 hover:bg-green-700 text-white gap-2">
                      <MessageCircle className="w-4 h-4" />
                      Message on WhatsApp
                    </Button>
                  </a>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Phone className="w-6 h-6 text-blue-900" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-2">Phone</h3>
                  <p className="text-slate-600 text-sm mb-4">Call us directly for urgent matters.</p>
                  <a href="tel:+2349018750976" className="text-blue-900 font-semibold hover:underline">
                    +234 901-875-0976
                  </a>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-6 h-6 text-blue-900" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 mb-2">Location</h3>
                  <p className="text-slate-600 text-sm">
                    Faculty of Business Administration
                    <br />
                    University of Lagos, Lagos
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Message Form */}
          <div className="bg-white rounded-lg border border-slate-200 p-8">
            <h2 className="text-2xl font-bold text-slate-900 mb-6">Send Us a Message</h2>

            <form className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Name</label>
                <input
                  type="text"
                  placeholder="Your name"
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Email</label>
                <input
                  type="email"
                  placeholder="your@email.com"
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Subject</label>
                <input
                  type="text"
                  placeholder="What's this about?"
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-2">Message</label>
                <textarea
                  placeholder="Tell us more..."
                  rows={5}
                  className="w-full px-4 py-2 rounded-lg border border-slate-300 focus:border-blue-900 focus:ring-2 focus:ring-blue-100 outline-none text-sm resize-none"
                ></textarea>
              </div>

              <Button className="w-full bg-blue-900 hover:bg-blue-800 text-white font-semibold mt-6">
                Send Message
              </Button>
            </form>

            <p className="text-xs text-slate-500 text-center mt-4">
              For fastest response, please use WhatsApp instead
            </p>
          </div>
        </div>

        {/* FAQ Section */}
        <div className="mt-16 bg-white rounded-lg border border-slate-200 p-8 max-w-3xl mx-auto">
          <h2 className="text-2xl font-bold text-slate-900 mb-8 text-center">Frequently Asked Questions</h2>

          <div className="space-y-6">
            <div>
              <h3 className="font-bold text-slate-900 mb-2">How do I bookmark a course?</h3>
              <p className="text-slate-600 text-sm">
                Visit any course page and click the "Bookmark Course" button. Your bookmarks are saved
                locally in your browser for quick access later.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 mb-2">Can I contribute my own resources?</h3>
              <p className="text-slate-600 text-sm">
                Absolutely! Contact us on WhatsApp with your course materials, notes, or past exam
                questions, and we'll review and add them to the platform.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 mb-2">Is CampusIntel free?</h3>
              <p className="text-slate-600 text-sm">
                Yes! CampusIntel is completely free for all students of the Faculty of Business
                Administration at University of Lagos.
              </p>
            </div>

            <div>
              <h3 className="font-bold text-slate-900 mb-2">When will courses for other faculties be added?</h3>
              <p className="text-slate-600 text-sm">
                We're currently focused on Business Administration. Contact us if you'd like to help
                expand CampusIntel to other faculties!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
