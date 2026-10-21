type CardName = 'about' | 'contact';

const isCard = (name: string | undefined): name is CardName => name === 'about' || name === 'contact';

/**
 * Nav: About and Contact open small frosted cards (one at a time; Esc or a click elsewhere closes
 * them, and #about / #contact links open them directly). Home closes them and calls onHome.
 * onCard hears every card opening or closing.
 */
export function bindCards(onHome: () => void, onCard: (open: boolean) => void = () => {}) {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('[data-nav]'));
  const cards: Record<CardName, HTMLElement> = {
    about: document.getElementById('about') as HTMLElement,
    contact: document.getElementById('contact') as HTMLElement,
  };
  let open: CardName | null = null;

  const show = (name: CardName | null) => {
    if (name !== open) onCard(name !== null);
    open = name;
    for (const key of Object.keys(cards) as CardName[]) cards[key].hidden = key !== name;
    for (const link of links) {
      if (isCard(link.dataset.nav)) link.setAttribute('aria-expanded', String(link.dataset.nav === name));
    }
    history.replaceState(null, '', name ? `#${name}` : location.pathname + location.search);
  };

  for (const link of links) {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const nav = link.dataset.nav;
      if (nav === 'home') {
        show(null);
        onHome();
      } else if (isCard(nav)) {
        show(open === nav ? null : nav);
      }
    });
  }

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !open) return;
    const link = links.find((l) => l.dataset.nav === open);
    show(null);
    link?.focus();
  });

  document.addEventListener('pointerdown', (event) => {
    if (!open) return;
    const target = event.target as Node;
    if (cards[open].contains(target) || links.some((l) => l.contains(target))) return;
    show(null);
  });

  const initial = location.hash.slice(1);
  if (isCard(initial)) show(initial);
}
