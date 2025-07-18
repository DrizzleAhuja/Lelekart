import { Link } from "wouter";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";

interface FooterContent {
  id: number;
  section: string;
  title: string;
  content: string;
  order: number;
  isActive: boolean;
}

// Helper function to format URL paths correctly
const formatPath = (path: string): string => {
  const trimmedPath = path.trim();

  // If it's an external URL (http/https), return as is
  if (trimmedPath.startsWith("http://") || trimmedPath.startsWith("https://")) {
    return trimmedPath;
  }

  // If the path already starts with a slash and doesn't contain spaces,
  // it's likely a valid URL path, so return it as is
  if (trimmedPath.startsWith("/") && !trimmedPath.includes(" ")) {
    return trimmedPath;
  }

  // Special case for About Us page which should always go to /about-us
  if (
    trimmedPath.toLowerCase() === "about-us" ||
    trimmedPath.toLowerCase() === "about us"
  ) {
    return "/about-us";
  }

  // For other cases, we assume this is a description text and not a valid URL
  // In this case, we default to the FAQ page to avoid 404 errors
  if (trimmedPath.includes(" ")) {
    return "/faq";
  }

  // Otherwise, ensure the path has a leading slash
  return `/${trimmedPath.replace(/^\/+/, "")}`;
};

export function Footer() {
  // Fetch footer content from the API
  const {
    data: footerContents = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["/api/footer-content"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/footer-content");
        if (!res.ok) {
          // Handle errors silently - footer content is not critical
          return [];
        }
        return res.json();
      } catch (err) {
        // Only log if it's not a network error
        if (err instanceof Error && !err.message.includes("Failed to fetch")) {
          console.warn("Error fetching footer content:", err);
        }
        return [];
      }
    },
    retry: false,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });

  // Group footer content by section
  const groupedContent = footerContents.reduce(
    (acc: Record<string, FooterContent[]>, item: FooterContent) => {
      if (item.isActive) {
        if (!acc[item.section]) {
          acc[item.section] = [];
        }
        acc[item.section].push(item);
      }
      return acc;
    },
    {}
  );

  // Sort content by order
  Object.keys(groupedContent).forEach((section) => {
    groupedContent[section].sort(
      (a: FooterContent, b: FooterContent) => a.order - b.order
    );
  });

  // Social media icons
  const socialIcons = {
    facebook: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z" />
      </svg>
    ),
    twitter: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M22.46 6C21.69 6.35 20.86 6.58 20 6.69C20.88 6.16 21.56 5.32 21.88 4.31C21.05 4.81 20.13 5.16 19.16 5.36C18.37 4.5 17.26 4 16 4C13.65 4 11.73 5.92 11.73 8.29C11.73 8.63 11.77 8.96 11.84 9.27C8.28 9.09 5.11 7.38 3 4.79C2.63 5.42 2.42 6.16 2.42 6.94C2.42 8.43 3.17 9.75 4.33 10.5C3.62 10.5 2.96 10.3 2.38 10C2.38 10 2.38 10 2.38 10.03C2.38 12.11 3.86 13.85 5.82 14.24C5.46 14.34 5.08 14.39 4.69 14.39C4.42 14.39 4.15 14.36 3.89 14.31C4.43 16 6 17.26 7.89 17.29C6.43 18.45 4.58 19.13 2.56 19.13C2.22 19.13 1.88 19.11 1.54 19.07C3.44 20.29 5.7 21 8.12 21C16 21 20.33 14.46 20.33 8.79C20.33 8.6 20.33 8.42 20.32 8.23C21.16 7.63 21.88 6.87 22.46 6Z" />
      </svg>
    ),
    youtube: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M10 15L15.19 12L10 9V15M21.56 7.17C21.69 7.64 21.78 8.27 21.84 9.07C21.91 9.87 21.94 10.56 21.94 11.16L22 12C22 14.19 21.84 15.8 21.56 16.83C21.31 17.73 20.73 18.31 19.83 18.56C19.36 18.69 18.5 18.78 17.18 18.84C15.88 18.91 14.69 18.94 13.59 18.94L12 19C7.81 19 5.2 18.84 4.17 18.56C3.27 18.31 2.69 17.73 2.44 16.83C2.31 16.36 2.22 15.73 2.16 14.93C2.09 14.13 2.06 13.44 2.06 12.84L2 12C2 9.81 2.16 8.2 2.44 7.17C2.69 6.27 3.27 5.69 4.17 5.44C4.64 5.31 5.5 5.22 6.82 5.16C8.12 5.09 9.31 5.06 10.41 5.06L12 5C16.19 5 18.8 5.16 19.83 5.44C20.73 5.69 21.31 6.27 21.56 7.17Z" />
      </svg>
    ),
    instagram: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M7.8 2H16.2C19.4 2 22 4.6 22 7.8V16.2C22 19.4 19.4 22 16.2 22H7.8C4.6 22 2 19.4 2 16.2V7.8C2 4.6 4.6 2 7.8 2M7.6 4C5.61 4 4 5.61 4 7.6V16.4C4 18.39 5.61 20 7.6 20H16.4C18.39 20 20 18.39 20 16.4V7.6C20 5.61 18.39 4 16.4 4H7.6M17.25 5.5C17.94 5.5 18.5 6.06 18.5 6.75C18.5 7.44 17.94 8 17.25 8C16.56 8 16 7.44 16 6.75C16 6.06 16.56 5.5 17.25 5.5M12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7M12 9C10.35 9 9 10.35 9 12C9 13.65 10.35 15 12 15C13.65 15 15 13.65 15 12C15 10.35 13.65 9 12 9Z" />
      </svg>
    ),
  };

  // Social media mapping (to match content title to icon)
  const socialMediaMapping: Record<string, JSX.Element> = {
    Facebook: socialIcons.facebook,
    Chunumunu: socialIcons.twitter, // Using Twitter icon for Chunumunu
    YouTube: socialIcons.youtube,
    Instagram: socialIcons.instagram,
  };

  if (isLoading) {
    return (
      <footer className="bg-gray-900 text-white mt-8">
        <div className="container mx-auto px-4 py-8 flex justify-center items-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      </footer>
    );
  }

  if (error) {
    console.error("Error loading footer content:", error);
    // Fall back to default footer if there's an error
    return <DefaultFooter />;
  }

  // If there's no content, show default footer
  if (Object.keys(groupedContent).length === 0) {
    return <DefaultFooter />;
  }

  return (
    <footer className="bg-cream text-black border-t border-cream py-8 mt-8">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* About Section */}
          {groupedContent.about && (
            <div>
              <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
                About
              </h3>
              <ul className="space-y-2 text-sm">
                {groupedContent.about.map((item: FooterContent) => (
                  <li key={item.id}>
                    <Link
                      href={formatPath(item.content)}
                      className="hover:underline"
                      target={
                        item.content.trim().startsWith("http")
                          ? "_blank"
                          : "_self"
                      }
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Help Section */}
          {groupedContent.help && (
            <div>
              <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
                Help
              </h3>
              <ul className="space-y-2 text-sm">
                {groupedContent.help.map((item: FooterContent) => (
                  <li key={item.id}>
                    <Link
                      href={formatPath(item.content)}
                      className="hover:underline"
                      target={
                        item.content.trim().startsWith("http")
                          ? "_blank"
                          : "_self"
                      }
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Consumer Policy Section */}
          {groupedContent.consumer_policy && (
            <div>
              <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
                Consumer Policy
              </h3>
              <ul className="space-y-2 text-sm">
                {groupedContent.consumer_policy.map((item: FooterContent) => (
                  <li key={item.id}>
                    <Link
                      href={formatPath(item.content)}
                      className="hover:underline"
                      target={
                        item.content.trim().startsWith("http")
                          ? "_blank"
                          : "_self"
                      }
                    >
                      {item.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Social Section */}
          {groupedContent.social && (
            <div>
              <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
                Social
              </h3>
              <ul className="space-y-2 text-sm">
                {groupedContent.social.map((item: FooterContent) => (
                  <li key={item.id}>
                    {item.content.trim().startsWith("http") ? (
                      <a
                        href={item.content.trim()}
                        className="hover:underline flex items-center"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {socialMediaMapping[item.title] || null}
                        {item.title}
                      </a>
                    ) : (
                      <Link
                        href={formatPath(item.content)}
                        className="hover:underline flex items-center"
                      >
                        {socialMediaMapping[item.title] || null}
                        {item.title}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
              {/* Mail Us Section */}
              {groupedContent.mail_us && groupedContent.mail_us.length > 0 ? (
                <div className="mt-6">
                  <h3 className="text-gray-400 font-medium mb-2 uppercase text-sm">
                    Mail Us:
                  </h3>
                  <p className="text-xs leading-relaxed">
                    {groupedContent.mail_us.length === 1 &&
                    groupedContent.mail_us[0].content.includes("\n")
                      ? // Handle case where content has embedded newlines
                        groupedContent.mail_us[0].content
                          .split("\n")
                          .map((line: string, index: number) => (
                            <span key={index}>
                              {line}
                              {index <
                                groupedContent.mail_us[0].content.split("\n")
                                  .length -
                                  1 && <br />}
                            </span>
                          ))
                      : // Handle case with multiple content entries
                        groupedContent.mail_us
                          .sort(
                            (a: FooterContent, b: FooterContent) =>
                              a.order - b.order
                          )
                          .map((item: FooterContent, index: number) => (
                            <span key={item.id}>
                              {item.content}
                              {index < groupedContent.mail_us.length - 1 && (
                                <br />
                              )}
                            </span>
                          ))}
                  </p>
                </div>
              ) : (
                <div className="mt-6">
                  <h3 className="text-gray-400 font-medium mb-2 uppercase text-sm">
                    Mail Us:
                  </h3>
                  <p className="text-xs leading-relaxed">
                    Lelekart Internet Private Limited,
                    <br />
                    Buildings Alyssa, Begonia &<br />
                    Clove Embassy Tech Village,
                    <br />
                    Outer Ring Road, Devarabeesanahalli Village,
                    <br />
                    Bengaluru, 560103,
                    <br />
                    Karnataka, India
                    <br />
                    Email: support@lelekart.com
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="border-t border-gray-700 mt-8 pt-8 text-center text-xs text-gray-400">
          <p>
            &copy; {new Date().getFullYear()} Lelekart.com. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}

// Default footer as fallback
function DefaultFooter() {
  // Default links for each section
  const defaultLinks = {
    about: [
      { name: "Contact Us", url: "/contact" },
      { name: "About Us", url: "/about-us" },
      { name: "Careers", url: "/careers" },
      { name: "Lelekart Stories", url: "/stories" },
      { name: "Press", url: "/press" },
      { name: "Corporate Information", url: "/corporate" },
    ],
    help: [
      { name: "Payments", url: "/payments" },
      { name: "Shipping", url: "/shipping" },
      { name: "Cancellation & Returns", url: "/returns" },
      { name: "FAQ", url: "/faq" },
      { name: "Report Infringement", url: "/report" },
    ],
    policy: [
      { name: "Return Policy", url: "/return-policy" },
      { name: "Terms Of Use", url: "/terms" },
      { name: "Security", url: "/security" },
      { name: "Privacy", url: "/privacy" },
      { name: "Sitemap", url: "/sitemap" },
    ],
    social: [
      { name: "Facebook", url: "https://facebook.com", icon: "facebook" },
      { name: "Chunumunu", url: "https://twitter.com", icon: "twitter" }, // Using Twitter icon for Chunumunu
      {
        name: "YouTube",
        url: "https://www.youtube.com/@Lelekart_Shop",
        icon: "youtube",
      },
      { name: "Instagram", url: "https://instagram.com", icon: "instagram" },
    ],
  };

  // Social media icons
  const socialIcons = {
    facebook: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M12 2.04C6.5 2.04 2 6.53 2 12.06C2 17.06 5.66 21.21 10.44 21.96V14.96H7.9V12.06H10.44V9.85C10.44 7.34 11.93 5.96 14.22 5.96C15.31 5.96 16.45 6.15 16.45 6.15V8.62H15.19C13.95 8.62 13.56 9.39 13.56 10.18V12.06H16.34L15.89 14.96H13.56V21.96A10 10 0 0 0 22 12.06C22 6.53 17.5 2.04 12 2.04Z" />
      </svg>
    ),
    twitter: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M22.46 6C21.69 6.35 20.86 6.58 20 6.69C20.88 6.16 21.56 5.32 21.88 4.31C21.05 4.81 20.13 5.16 19.16 5.36C18.37 4.5 17.26 4 16 4C13.65 4 11.73 5.92 11.73 8.29C11.73 8.63 11.77 8.96 11.84 9.27C8.28 9.09 5.11 7.38 3 4.79C2.63 5.42 2.42 6.16 2.42 6.94C2.42 8.43 3.17 9.75 4.33 10.5C3.62 10.5 2.96 10.3 2.38 10C2.38 10 2.38 10 2.38 10.03C2.38 12.11 3.86 13.85 5.82 14.24C5.46 14.34 5.08 14.39 4.69 14.39C4.42 14.39 4.15 14.36 3.89 14.31C4.43 16 6 17.26 7.89 17.29C6.43 18.45 4.58 19.13 2.56 19.13C2.22 19.13 1.88 19.11 1.54 19.07C3.44 20.29 5.7 21 8.12 21C16 21 20.33 14.46 20.33 8.79C20.33 8.6 20.33 8.42 20.32 8.23C21.16 7.63 21.88 6.87 22.46 6Z" />
      </svg>
    ),
    youtube: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M10 15L15.19 12L10 9V15M21.56 7.17C21.69 7.64 21.78 8.27 21.84 9.07C21.91 9.87 21.94 10.56 21.94 11.16L22 12C22 14.19 21.84 15.8 21.56 16.83C21.31 17.73 20.73 18.31 19.83 18.56C19.36 18.69 18.5 18.78 17.18 18.84C15.88 18.91 14.69 18.94 13.59 18.94L12 19C7.81 19 5.2 18.84 4.17 18.56C3.27 18.31 2.69 17.73 2.44 16.83C2.31 16.36 2.22 15.73 2.16 14.93C2.09 14.13 2.06 13.44 2.06 12.84L2 12C2 9.81 2.16 8.2 2.44 7.17C2.69 6.27 3.27 5.69 4.17 5.44C4.64 5.31 5.5 5.22 6.82 5.16C8.12 5.09 9.31 5.06 10.41 5.06L12 5C16.19 5 18.8 5.16 19.83 5.44C20.73 5.69 21.31 6.27 21.56 7.17Z" />
      </svg>
    ),
    instagram: (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="w-4 h-4 mr-2"
      >
        <path d="M7.8 2H16.2C19.4 2 22 4.6 22 7.8V16.2C22 19.4 19.4 22 16.2 22H7.8C4.6 22 2 19.4 2 16.2V7.8C2 4.6 4.6 2 7.8 2M7.6 4C5.61 4 4 5.61 4 7.6V16.4C4 18.39 5.61 20 7.6 20H16.4C18.39 20 20 18.39 20 16.4V7.6C20 5.61 18.39 4 16.4 4H7.6M17.25 5.5C17.94 5.5 18.5 6.06 18.5 6.75C18.5 7.44 17.94 8 17.25 8C16.56 8 16 7.44 16 6.75C16 6.06 16.56 5.5 17.25 5.5M12 7C14.76 7 17 9.24 17 12C17 14.76 14.76 17 12 17C9.24 17 7 14.76 7 12C7 9.24 9.24 7 12 7M12 9C10.35 9 9 10.35 9 12C9 13.65 10.35 15 12 15C13.65 15 15 13.65 15 12C15 10.35 13.65 9 12 9Z" />
      </svg>
    ),
  };

  // Get social icon by name
  const getSocialIcon = (name: string) => {
    const key = name.toLowerCase() as keyof typeof socialIcons;
    return socialIcons[key] || null;
  };

  return (
    <footer className="bg-gray-900 text-white mt-8">
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
              About
            </h3>
            <ul className="space-y-2 text-sm">
              {defaultLinks.about.map((link, index) => (
                <li key={index}>
                  <Link
                    href={formatPath(link.url)}
                    className="hover:underline"
                    target={link.url.startsWith("http") ? "_blank" : "_self"}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
              Help
            </h3>
            <ul className="space-y-2 text-sm">
              {defaultLinks.help.map((link, index) => (
                <li key={index}>
                  <Link
                    href={formatPath(link.url)}
                    className="hover:underline"
                    target={link.url.startsWith("http") ? "_blank" : "_self"}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
              Policy
            </h3>
            <ul className="space-y-2 text-sm">
              {defaultLinks.policy.map((link, index) => (
                <li key={index}>
                  <Link
                    href={formatPath(link.url)}
                    className="hover:underline"
                    target={link.url.startsWith("http") ? "_blank" : "_self"}
                  >
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-gray-400 font-medium mb-4 uppercase text-sm">
              Social
            </h3>
            <ul className="space-y-2 text-sm">
              {defaultLinks.social.map((link, index) => (
                <li key={index}>
                  <a
                    href={link.url}
                    className="hover:underline flex items-center"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.icon && getSocialIcon(link.icon)}
                    {link.name}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-6">
              <h3 className="text-gray-400 font-medium mb-2 uppercase text-sm">
                Mail Us:
              </h3>
              <p className="text-xs leading-relaxed">
                Lelekart Internet Private Limited,
                <br />
                Buildings Alyssa, Begonia &<br />
                Clove Embassy Tech Village,
                <br />
                Outer Ring Road, Devarabeesanahalli Village,
                <br />
                Bengaluru, 560103,
                <br />
                Karnataka, India
                <br />
                Email: support@lelekart.com
              </p>
            </div>
          </div>
        </div>
        <div className="border-t border-gray-700 mt-8 pt-8 text-center text-xs text-gray-400">
          <p>
            &copy; {new Date().getFullYear()} Lelekart.com. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
