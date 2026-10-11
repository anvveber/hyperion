'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import NavigationSearch from './NavigationSearch';
import UserMenu from './UserMenu';
import AccountMenuItems from './AccountMenuItems';
import UserAvatar from './UserAvatar';
import StatusBar from './StatusBar';
import { formatUserDisplayName } from '@/lib/nameUtils';

interface NavigationProps {
  userEmail?: string;
  userName?: string | null;
  userNickname?: string | null;
  userPhoto?: string | null;
  currentPath?: string;
}

const navIcons: Record<string, React.ReactNode> = {
  dashboard: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  ),
  people: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
    </svg>
  ),
  groups: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 7.125C2.25 6.504 2.754 6 3.375 6h6c.621 0 1.125.504 1.125 1.125v3.75c0 .621-.504 1.125-1.125 1.125h-6a1.125 1.125 0 01-1.125-1.125v-3.75zM14.25 8.625c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v8.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-8.25zM3.75 16.125c0-.621.504-1.125 1.125-1.125h5.25c.621 0 1.125.504 1.125 1.125v2.25c0 .621-.504 1.125-1.125 1.125h-5.25a1.125 1.125 0 01-1.125-1.125v-2.25z" />
    </svg>
  ),
  journal: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
    </svg>
  ),
  relationshipTypes: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
    </svg>
  ),
  map: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" />
    </svg>
  ),
  calendar: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
    </svg>
  ),
  advancedSearch: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
    </svg>
  ),
};

interface NavItem {
  href: string;
  labelKey: string;
  createHref?: string;
  createLabelKey?: string;
}

// Records first, then the views that look across them. The rail draws a rule
// between the two blocks.
const recordItems: NavItem[] = [
  { href: '/dashboard', labelKey: 'dashboard' },
  { href: '/people', labelKey: 'people', createHref: '/people/new', createLabelKey: 'people' },
  { href: '/groups', labelKey: 'groups', createHref: '/groups/new', createLabelKey: 'groups' },
  { href: '/relationship-types', labelKey: 'relationshipTypes', createHref: '/relationship-types/new', createLabelKey: 'relationshipTypes' },
];

const viewItems: NavItem[] = [
  { href: '/journal', labelKey: 'journal', createHref: '/journal/new', createLabelKey: 'journal' },
  { href: '/map', labelKey: 'map' },
  { href: '/calendar', labelKey: 'calendar' },
  { href: '/search', labelKey: 'advancedSearch' },
];

const navItems: NavItem[] = [...recordItems, ...viewItems];

const settingsIcon = (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" aria-hidden="true">
    <path strokeLinecap="round" strokeLinejoin="round" d="M10.343 3.94c.09-.542.56-.94 1.11-.94h1.093c.55 0 1.02.398 1.11.94l.149.894c.07.424.384.764.78.93.398.164.855.142 1.205-.108l.737-.527a1.125 1.125 0 011.45.12l.773.774c.39.389.44 1.002.12 1.45l-.527.737c-.25.35-.272.806-.107 1.204.165.397.505.71.93.78l.893.15c.543.09.94.559.94 1.109v1.094c0 .55-.397 1.02-.94 1.11l-.894.149c-.424.07-.764.383-.929.78-.165.398-.143.854.107 1.204l.527.738c.32.447.269 1.06-.12 1.45l-.774.773a1.125 1.125 0 01-1.449.12l-.738-.527c-.35-.25-.806-.272-1.203-.107-.398.165-.71.505-.781.929l-.149.894c-.09.542-.56.94-1.11.94h-1.094c-.55 0-1.019-.398-1.11-.94l-.148-.894c-.071-.424-.384-.764-.781-.93-.398-.164-.854-.142-1.204.108l-.738.527c-.447.32-1.06.269-1.45-.12l-.773-.774a1.125 1.125 0 01-.12-1.45l.527-.737c.25-.35.272-.806.108-1.204-.165-.397-.506-.71-.93-.78l-.894-.15c-.542-.09-.94-.56-.94-1.109v-1.094c0-.55.398-1.02.94-1.11l.894-.149c.424-.07.765-.383.93-.78.165-.398.143-.854-.108-1.204l-.526-.738a1.125 1.125 0 01.12-1.45l.773-.773a1.125 1.125 0 011.45-.12l.737.527c.35.25.807.272 1.204.107.397-.165.71-.505.78-.929l.15-.894z" />
    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);

export default function Navigation({ userEmail, userName, userNickname, userPhoto, currentPath }: NavigationProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');

  const displayName = formatUserDisplayName({ nickname: userNickname, name: userName, email: userEmail });

  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const desktopSearchRef = useRef<HTMLDivElement>(null);
  // Only a deliberate dismissal should pull focus back to the search button.
  // Handing it back when the drawer took over, or when a result was picked,
  // would park focus on a control the user has already moved past.
  const restoreSearchFocus = useRef(false);

  // Is the wide-screen search field actually on screen? offsetParent is null
  // while it is display:none, which answers the question without restating the
  // md breakpoint as a pixel value here.
  const desktopSearchVisible = () => desktopSearchRef.current?.offsetParent != null;

  // The two mobile surfaces are mutually exclusive: opening one puts the other away.
  const openMobileMenu = () => {
    restoreSearchFocus.current = false;
    setMobileSearchOpen(false);
    setMobileMenuOpen(true);
  };

  const openMobileSearch = () => {
    setMobileMenuOpen(false);
    setMobileSearchOpen(true);
  };

  const closeMobileSearch = (reason: 'dismiss' | 'navigate' = 'dismiss') => {
    restoreSearchFocus.current = reason === 'dismiss';
    setMobileSearchOpen(false);
  };

  // Collapsing the field unmounts the input, which would drop focus to the body
  // and send the next Tab back to the top of the document. Hand it to the button
  // that opened the field instead. Runs after paint, once the button is visible
  // again, because focus() is a no-op on a display:none element.
  useEffect(() => {
    if (!mobileSearchOpen && restoreSearchFocus.current) {
      restoreSearchFocus.current = false;
      searchButtonRef.current?.focus();
    }
  }, [mobileSearchOpen]);

  // The field's own Escape handler only fires while the input has focus, which a
  // tap on the header padding or a dismissed software keyboard is enough to lose.
  useEffect(() => {
    if (!mobileSearchOpen) return;

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMobileSearch();
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileSearchOpen]);

  // Widening past the breakpoint reveals the desktop field while the mobile one
  // stays mounted and invisible, holding a query the user can no longer see.
  // Put it away instead, without stealing focus into the hidden header.
  useEffect(() => {
    if (!mobileSearchOpen) return;

    const handleResize = () => {
      if (desktopSearchVisible()) {
        setMobileSearchOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mobileSearchOpen]);

  // Cmd+K focuses the desktop field, which is display:none below the md
  // breakpoint, so the shortcut would otherwise do nothing on narrow screens.
  useEffect(() => {
    const handleShortcut = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 'k') return;
      if (desktopSearchVisible()) return;
      e.preventDefault();
      openMobileSearch();
    };

    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    // Cleanup on unmount
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  const isActive = (href: string) => {
    if (!currentPath) return false;
    return currentPath === href || currentPath.startsWith(`${href}/`);
  };

  const activeItem = navItems.find((item) => isActive(item.href));
  const sectionLabel = activeItem
    ? tNav(activeItem.labelKey)
    : currentPath?.startsWith('/settings')
      ? tNav('settings')
      : null;

  const renderRailItem = (item: NavItem) => {
    const active = isActive(item.href);
    return (
      <li key={item.href} className={`group relative flex items-stretch ${active ? 'bg-surface-elevated' : ''}`}>
        {active && <span aria-hidden="true" className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary" />}
        <Link
          href={item.href}
          aria-current={active ? 'page' : undefined}
          className={`flex-1 flex items-center gap-3 pl-5 pr-2 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
            active
              ? 'text-foreground font-medium'
              : 'text-muted hover:text-foreground hover:bg-surface-elevated/60'
          }`}
        >
          <span className={active ? 'text-primary' : ''}>{navIcons[item.labelKey]}</span>
          {tNav(item.labelKey)}
        </Link>
        {item.createHref && (
          <Link
            href={item.createHref}
            aria-label={`${tCommon('create')} ${tNav(item.createLabelKey || item.labelKey)}`}
            title={`${tCommon('create')} ${tNav(item.createLabelKey || item.labelKey)}`}
            className="flex items-center px-3 text-muted hover:text-primary transition-colors opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
          </Link>
        )}
      </li>
    );
  };

  return (
    <nav className="hy-shell">
      {/* Status banner across the very top of every signed-in page */}
      <div className="hy-banner fixed top-0 inset-x-0 z-50 h-[var(--banner-h)] flex items-center justify-center px-4 font-mono text-[0.625rem] font-semibold uppercase tracking-[0.24em] select-none">
        <span className="truncate">{tNav('classification')}</span>
      </div>

      {/* Command rail (wide screens) */}
      <aside
        aria-label={tNav('menuLabel')}
        className="hidden md:flex fixed top-[var(--banner-h)] bottom-0 left-0 z-40 w-[var(--rail-w)] flex-col bg-rail border-r border-border"
      >
        <Link
          href="/dashboard"
          className="flex items-center gap-3 h-14 px-5 border-b border-border shrink-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary"
        >
          <Image src="/logo.svg" alt="" width={34} height={22} />
          <span className="font-mono text-sm font-semibold tracking-[0.18em] uppercase text-foreground">
            {tNav('appName')}
          </span>
        </Link>

        <div className="flex-1 overflow-y-auto py-3">
          <ul className="space-y-px">{recordItems.map(renderRailItem)}</ul>
          <div className="mx-5 my-3 border-t border-border" />
          <ul className="space-y-px">{viewItems.map(renderRailItem)}</ul>
        </div>

        <div className="border-t border-border py-2 shrink-0">
          <Link
            href="/settings"
            aria-current={currentPath?.startsWith('/settings') ? 'page' : undefined}
            className={`flex items-center gap-3 px-5 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-primary ${
              currentPath?.startsWith('/settings') ? 'text-foreground' : 'text-muted hover:text-foreground'
            }`}
          >
            {settingsIcon}
            {tNav('settings')}
          </Link>
        </div>
      </aside>

      {/* Top bar: section title, search and account on wide screens; logo, search and menu on phones */}
      <div className="sticky top-[var(--banner-h)] z-30 bg-surface/95 backdrop-blur border-b border-border pt-[env(safe-area-inset-top)]">
        <div className="px-4 sm:px-6">
          <div className="relative flex items-center justify-between h-14">
            <Link href="/dashboard" className={`items-center shrink-0 z-10 md:hidden ${mobileSearchOpen ? 'hidden' : 'flex'}`}>
              <Image
                src="/logo.svg"
                alt="Nametag Logo"
                width={48}
                height={30}
                className="text-foreground"
              />
            </Link>

            {/* Where you are, as a console path */}
            <div className="hidden md:flex items-center gap-2 min-w-0 font-mono text-xs uppercase tracking-[0.12em] z-10">
              <span className="text-muted">{tNav('appName')}</span>
              {sectionLabel && (
                <>
                  <span className="text-muted" aria-hidden="true">/</span>
                  <span className="text-foreground font-semibold truncate">{sectionLabel}</span>
                </>
              )}
            </div>

            {/* Desktop search, absolutely centered in the row */}
            <div ref={desktopSearchRef} className="hidden md:block absolute left-1/2 -translate-x-1/2 w-full max-w-sm lg:max-w-md px-4">
              <NavigationSearch />
            </div>

            {/* Mobile search, expanded on demand in place of the rest of the row */}
            {mobileSearchOpen && (
              <div className="md:hidden flex items-center gap-1 w-full">
                <div className="flex-1 min-w-0">
                  <NavigationSearch autoFocus onClose={closeMobileSearch} />
                </div>
                <button
                  type="button"
                  onClick={() => closeMobileSearch()}
                  className="shrink-0 px-2 py-3 text-sm font-medium text-secondary hover:text-foreground transition-colors"
                >
                  {tCommon('cancel')}
                </button>
              </div>
            )}

            {/* Right section: user menu (desktop), search and menu buttons (mobile) */}
            <div className={`items-center space-x-1 sm:space-x-2 z-10 ${mobileSearchOpen ? 'hidden md:flex' : 'flex'}`}>
              <button
                ref={searchButtonRef}
                type="button"
                onClick={openMobileSearch}
                className="md:hidden p-3 rounded-md text-foreground hover:bg-surface-elevated transition-colors"
                aria-label={tCommon('search')}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </button>

              {userEmail && (
                <div className="hidden md:block">
                  <UserMenu userEmail={userEmail} userName={userName} userNickname={userNickname} userPhoto={userPhoto} />
                </div>
              )}

              {/* Mobile menu button */}
              <button
                type="button"
                onClick={() => (mobileMenuOpen ? setMobileMenuOpen(false) : openMobileMenu())}
                aria-expanded={mobileMenuOpen}
                className="md:hidden p-3 rounded-md text-foreground hover:bg-surface-elevated transition-colors"
                aria-label={mobileMenuOpen ? tNav('closeMenu') : tNav('openMenu')}
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  {mobileMenuOpen ? (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  ) : (
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  )}
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <StatusBar operator={userEmail ? displayName : undefined} />

      {/* Mobile menu overlay - slides in from right */}
      {mobileMenuOpen && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-40 transition-opacity"
            onClick={() => setMobileMenuOpen(false)}
            aria-hidden="true"
          />

          {/* Mobile menu panel */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label={tNav('menuLabel')}
            className="md:hidden fixed top-0 right-0 bottom-0 w-[90%] max-w-md bg-surface shadow-xl z-50 transform transition-transform duration-300 ease-in-out pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] pr-[env(safe-area-inset-right)]"
          >
            <div className="h-full flex flex-col">
              {/* Menu header: who is signed in, plus the close button */}
              <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
                {userEmail ? (
                  <div className="flex items-center gap-3 min-w-0">
                    <UserAvatar displayName={displayName} photo={userPhoto} size="md" />
                    <span className="truncate text-base font-medium text-foreground">{displayName}</span>
                  </div>
                ) : (
                  <h2 className="text-lg font-semibold text-foreground">{tNav('menuLabel')}</h2>
                )}
                <button
                  onClick={() => setMobileMenuOpen(false)}
                  className="shrink-0 p-2 rounded-md text-muted hover:bg-surface-elevated transition-colors"
                  aria-label={tNav('closeMenu')}
                >
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Mobile nav items */}
              <nav className="flex-1 overflow-y-auto p-4">
                <div className="space-y-1">
                  {navItems.map((item) => (
                    <div key={item.href}>
                      {item.createHref ? (
                        <div className={`flex items-center rounded-lg overflow-hidden border ${
                          isActive(item.href)
                            ? 'bg-primary/10 border-primary'
                            : 'bg-surface-elevated border-border hover:bg-surface-elevated hover:border-primary/50'
                        }`}>
                          <Link
                            href={item.href}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`flex-1 flex items-center gap-2 px-4 py-3 text-base font-medium ${
                              isActive(item.href)
                                ? 'text-primary'
                                : 'text-foreground'
                            }`}
                          >
                            {navIcons[item.labelKey]}
                            {tNav(item.labelKey)}
                          </Link>
                          <div className={`w-px h-8 ${
                            isActive(item.href)
                              ? 'bg-primary/30'
                              : 'bg-border'
                          }`} />
                          <Link
                            href={item.createHref}
                            onClick={() => setMobileMenuOpen(false)}
                            className={`px-4 py-3 transition-colors ${
                              isActive(item.href)
                                ? 'text-primary'
                                : 'text-muted hover:text-primary'
                            }`}
                            aria-label={`${tCommon('create')} ${tNav(item.createLabelKey || item.labelKey)}`}
                          >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                          </Link>
                        </div>
                      ) : (
                        <Link
                          href={item.href}
                          onClick={() => setMobileMenuOpen(false)}
                          className={`flex items-center gap-2 px-4 py-3 rounded-lg text-base font-medium border transition-colors ${
                            isActive(item.href)
                              ? 'text-primary bg-primary/10 border-primary'
                              : 'text-foreground bg-surface-elevated border-border hover:bg-surface-elevated hover:border-primary/50'
                          }`}
                        >
                          {navIcons[item.labelKey]}
                          {tNav(item.labelKey)}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </nav>

              {/* Account actions, mirroring the desktop user menu */}
              {userEmail && (
                <div className="border-t border-border py-1">
                  <AccountMenuItems variant="comfortable" onNavigate={() => setMobileMenuOpen(false)} />
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
  );
}
