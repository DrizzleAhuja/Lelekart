import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { Link } from "wouter";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type Category = {
  id: number;
  name: string;
  slug: string;
  description?: string;
  active: boolean;
  featured: boolean;
};

type Subcategory = {
  id: number;
  name: string;
  slug: string;
  categoryId: number;
  parentId?: number | null;
  description?: string;
  displayOrder: number;
  active: boolean;
  featured: boolean;
};

export function CategoryMegaMenu() {
  const [activeCategory, setActiveCategory] = useState<number | null>(null);
  const [expandedSubcategory, setExpandedSubcategory] = useState<number | null>(null);
  
  // Fetch categories
  const { data: categories, isLoading: categoriesLoading } = useQuery<Category[]>({
    queryKey: ["/api/categories"],
  });
  
  // Fetch all subcategories
  const { data: subcategories, isLoading: subcategoriesLoading } = useQuery<Subcategory[]>({
    queryKey: ["/api/subcategories/all"],
  });
  
  // Get subcategories by category ID (only top-level, i.e., parentId is null/undefined)
  const getSubcategoriesForCategory = (categoryId: number): Subcategory[] => {
    if (!subcategories) return [];
    return subcategories.filter(subcategory => subcategory.categoryId === categoryId && subcategory.active && (!subcategory.parentId || subcategory.parentId === 0));
  };
  
  // Get subcategory2 (children) for a given subcategory
  const getSubcategory2ForSubcategory = (subcategoryId: number): Subcategory[] => {
    if (!subcategories) return [];
    return subcategories.filter(subcategory => subcategory.parentId === subcategoryId && subcategory.active);
  };
  
  // Check if a category has any active subcategories
  const hasSubcategories = (categoryId: number): boolean => {
    if (!subcategories) return false;
    return subcategories.some(subcategory => subcategory.categoryId === categoryId && subcategory.active);
  };
  
  // Loading state
  if (categoriesLoading || subcategoriesLoading) {
    return (
      <div className="w-full bg-primary-foreground/20 h-10 flex justify-center items-center">
        <div className="flex space-x-8">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-6 w-20" />
          ))}
        </div>
      </div>
    );
  }
  
  // No categories to display
  if (!categories || categories.length === 0) {
    return null;
  }
  
  // If there are categories without subcategories, they should be shown as direct links
  const categoriesWithoutSubcategories = categories.filter(category => 
    category.active && !hasSubcategories(category.id)
  );
  
  // Categories with subcategories should be dropdown menus
  const categoriesWithSubcategories = categories.filter(category => 
    category.active && hasSubcategories(category.id)
  );
  
  return (
    <div className="w-full bg-cream border-b border-cream shadow-md z-30 sticky top-14">
      <div className="container mx-auto">
        <div className="flex justify-center">
          <div className="flex flex-nowrap gap-2 py-0 overflow-x-auto scrollbar-hide">
            {/* Categories with subcategories - shown as dropdowns */}
            {categoriesWithSubcategories.map(category => (
              <DropdownMenu key={category.id}>
                <DropdownMenuTrigger className="px-3 py-2 text-base font-bold bg-offwhite hover:bg-cream hover:text-dark rounded-lg shadow border border-cream flex items-center transition-colors duration-75 whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-primary">
                  {category.name}
                  <ChevronDown className="ml-1 h-4 w-4 transition-transform duration-75 text-dark" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="center" className="w-80 bg-white rounded-xl shadow-2xl border border-cream p-3 mt-2 z-50">
                  {getSubcategoriesForCategory(category.id).map(subcategory => {
                    const subcategory2List = getSubcategory2ForSubcategory(subcategory.id);
                    return (
                      <div key={subcategory.id} className="relative group">
                        <div
                          className={cn(
                            "flex items-center w-full px-3 py-2 rounded-md transition-colors duration-75 cursor-pointer group-hover:bg-cream hover:bg-cream",
                            expandedSubcategory === subcategory.id ? "bg-cream" : ""
                          )}
                          onMouseEnter={() => setExpandedSubcategory(subcategory.id)}
                          onMouseLeave={() => setExpandedSubcategory(null)}
                        >
                          <span className="flex-1 font-medium text-dark">
                            {subcategory.name}
                            <ChevronDown className="ml-1 h-3 w-3 inline-block text-dark/70 align-middle" />
                          </span>
                          {subcategory2List.length > 0 && (
                            <span
                              onClick={e => {
                                e.stopPropagation();
                                setExpandedSubcategory(
                                  expandedSubcategory === subcategory.id ? null : subcategory.id
                                );
                              }}
                             className={cn(
                               "ml-2 flex items-center cursor-pointer transition-transform duration-200",
                               expandedSubcategory === subcategory.id ? "rotate-180 text-dark" : "text-dark/60"
                             )}
                              tabIndex={0}
                              role="button"
                              aria-label="Show subcategories"
                            >
                              <ChevronDown className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                        {/* Inline subcategory2 list, with vertical line and animation */}
                        {expandedSubcategory === subcategory.id && subcategory2List.length > 0 && (
                          <div className="pl-7 border-l-2 border-cream ml-2 mt-1 space-y-1 transition-all duration-200 bg-white rounded-lg shadow-lg border border-cream">
                            {subcategory2List.map(sub2 => (
                              <div
                                key={sub2.id}
                               className="flex items-center px-3 py-1 rounded-md hover:bg-cream cursor-pointer text-sm text-dark transition-colors duration-100"
                                onClick={e => {
                                  e.stopPropagation();
                                  window.location.assign(`/category/${category.slug}?subcategory=${subcategory.slug}&subcategory2=${sub2.slug}`);
                                }}
                              >
                                <span className="flex-1">{sub2.name}</span>
                                {sub2.featured && (
                                 <span className="ml-2 px-1 py-0.5 text-[10px] leading-none bg-blush text-white rounded-full">
                                    Featured
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                 <div className="my-2 border-t border-cream" />
                  <DropdownMenuItem asChild>
                    <div 
                      onClick={() => {
                        window.location.href = `/category/${category.slug}`;
                      }}
                     className="cursor-pointer w-full text-center text-dark font-semibold text-sm py-2 hover:bg-cream rounded-md"
                    >
                      View All {category.name}
                    </div>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ))}
            
            {/* Categories without subcategories - shown as simple links */}
            {categoriesWithoutSubcategories.map(category => (
              <Link 
                key={category.id} 
                href={`/category/${category.slug}`}
                className="px-3 py-2 text-base font-bold bg-offwhite hover:bg-cream hover:text-dark rounded-lg shadow border border-cream flex items-center whitespace-nowrap"
              >
                {category.name}
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}