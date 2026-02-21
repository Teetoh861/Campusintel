import { Mail, MessageCircle, MapPin } from 'lucide-react'

export function Footer() {
  return (
    <footer className="bg-blue-900 text-white mt-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
          {/* About */}
          <div>
            <h3 className="text-lg font-bold mb-4">CampusIntel</h3>
            <p className="text-blue-100 text-sm leading-relaxed">
              Your Academic Intelligence Hub for Department of Business Administration at University of Lagos. The best and most trusted academic resource platform in UNILAG.
            </p>
            <p className="text-blue-100 text-sm leading-relaxed mt-3">
              Have materials to share? Help your fellow students by contributing notes, past questions, and study resources.
            </p>
          </div>

          {/* Quick Links */}
          <div>
            <h3 className="text-lg font-bold mb-4">Quick Links</h3>
            <ul className="space-y-2 text-sm text-blue-100">
              <li>
                <a href="/courses" className="hover:text-white transition-colors">
                  Browse Courses
                </a>
              </li>
              <li>
                <a href="/bookmarks" className="hover:text-white transition-colors">
                  My Bookmarks
                </a>
              </li>
              <li>
                <a
                  href="https://wa.me/2349018750976?text=I%20want%20to%20submit%20course%20resources"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  Submit Resources
                </a>
              </li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="text-lg font-bold mb-4">Contact Us</h3>
            <div className="space-y-3 text-sm text-blue-100">
              <div className="flex items-center gap-2">
                <MessageCircle className="w-4 h-4" />
                <a
                  href="https://wa.me/2349018750976"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-white transition-colors"
                >
                  WhatsApp: 0901-875-0976
                </a>
              </div>
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4" />
                <a
                  href="mailto:support@campusintel.com"
                  className="hover:text-white transition-colors"
                >
                  Email Us
                </a>
              </div>
              <div className="flex items-center gap-2">
                <MapPin className="w-4 h-4" />
                <span>UNILAG, Lagos</span>
              </div>
            </div>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-blue-800 pt-8">
          <p className="text-center text-blue-100 text-sm">
            © 2025 CampusIntel. Department of Business Administration, University of Lagos.
          </p>
        </div>
      </div>
    </footer>
  )
}
