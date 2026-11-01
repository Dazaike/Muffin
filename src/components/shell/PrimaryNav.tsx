import { useLocation } from "react-router-dom";
import { Clock, Compass, Heart, House, Library, Search, Settings as SettingsIcon, User, Users, Wallet as WalletIcon } from "lucide-react";
import { useOnlineFriendCount } from "@/components/friends/useFriends";
import { useLibrary } from "@/store/library";
import { NavTabs, type NavItem } from "./NavTabs";

const ICON = { size: 18, strokeWidth: 1.75 } as const;

export const NAV_PAGES: NavItem[] = [
  { to: "/", label: "Home", icon: <House {...ICON} />, end: true },
  { to: "/discover", label: "Discover", icon: <Compass {...ICON} /> },
  { to: "/search", label: "Search", icon: <Search {...ICON} /> },
  { to: "/library", label: "My Library", icon: <Library {...ICON} /> },
  { to: "/favorites", label: "Favorites", icon: <Heart {...ICON} /> },
  { to: "/recent", label: "Recently Played", icon: <Clock {...ICON} /> },
  { to: "/friends", label: "Friends", icon: <Users {...ICON} /> },
  { to: "/wallet", label: "Wallet", icon: <WalletIcon {...ICON} /> },
  { to: "/profile", label: "Profile", icon: <User {...ICON} /> },
  { to: "/settings", label: "Settings", icon: <SettingsIcon {...ICON} /> },
];

/** The app's top navigation: page tabs with library / favorites / online-friends badges. */
export function PrimaryNav() {
  const libraryCount = useLibrary((s) => s.entries.length);
  const favoriteCount = useLibrary((s) => s.entries.filter((e) => e.favorite).length);
  // The Friends page runs its own presence poll; avoid doubling it there.
  const onFriendsPage = useLocation().pathname.startsWith("/friends");
  const onlineFriends = useOnlineFriendCount(!onFriendsPage);
  return <NavTabs items={NAV_PAGES} badges={{ "/library": libraryCount, "/favorites": favoriteCount, "/friends": onlineFriends }} />;
}
