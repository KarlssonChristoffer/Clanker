/**
 * /tankeläsare content. `sv` is shown to players; `en` is what Jev reads (English is Jev's strongest
 * language). Changing a candidate's `en` or a property's `en`/criteria changes the matrix, so bump
 * MATRIX_VERSION to force a recompute.
 */

export const MATRIX_VERSION = 1;

export type Category = 'djur' | 'föremål' | 'mat' | 'plats' | 'wow';

export type Candidate = { id: string; sv: string; en: string; category: Category };

const c = (id: string, sv: string, en: string, category: Category): Candidate => ({ id, sv, en, category });

export const CANDIDATES: readonly Candidate[] = [
  // Djur
  c('katt', 'Katt', 'a domestic cat', 'djur'),
  c('hund', 'Hund', 'a dog', 'djur'),
  c('hast', 'Häst', 'a horse', 'djur'),
  c('ko', 'Ko', 'a cow', 'djur'),
  c('alg', 'Älg', 'a moose (elk), the large Scandinavian deer', 'djur'),
  c('bjorn', 'Björn', 'a brown bear', 'djur'),
  c('varg', 'Varg', 'a wolf', 'djur'),
  c('rav', 'Räv', 'a red fox', 'djur'),
  c('igelkott', 'Igelkott', 'a hedgehog', 'djur'),
  c('uggla', 'Uggla', 'an owl', 'djur'),
  c('pingvin', 'Pingvin', 'a penguin', 'djur'),
  c('haj', 'Haj', 'a shark', 'djur'),
  c('delfin', 'Delfin', 'a dolphin', 'djur'),
  c('orm', 'Orm', 'a snake', 'djur'),
  c('spindel', 'Spindel', 'a spider', 'djur'),
  c('bi', 'Bi', 'a honey bee', 'djur'),
  c('groda', 'Groda', 'a frog', 'djur'),
  c('lax', 'Lax', 'a salmon (the living fish)', 'djur'),
  c('sal', 'Säl', 'a seal (the marine mammal)', 'djur'),
  // Föremål
  c('mobil', 'Mobiltelefon', 'a smartphone', 'föremål'),
  c('dator', 'Dator', 'a personal computer', 'föremål'),
  c('cykel', 'Cykel', 'a bicycle', 'föremål'),
  c('bil', 'Bil', 'a car', 'föremål'),
  c('gitarr', 'Gitarr', 'a guitar', 'föremål'),
  c('paraply', 'Paraply', 'an umbrella', 'föremål'),
  c('nyckel', 'Nyckel', 'a door key', 'föremål'),
  c('sax', 'Sax', 'a pair of scissors', 'föremål'),
  c('penna', 'Penna', 'a pen', 'föremål'),
  c('tandborste', 'Tandborste', 'a toothbrush', 'föremål'),
  c('lampa', 'Lampa', 'a lamp', 'föremål'),
  c('soffa', 'Soffa', 'a sofa', 'föremål'),
  c('kylskap', 'Kylskåp', 'a refrigerator', 'föremål'),
  c('stearinljus', 'Stearinljus', 'a candle', 'föremål'),
  c('svard', 'Svärd', 'a sword', 'föremål'),
  c('bok', 'Bok', 'a book', 'föremål'),
  c('klocka', 'Klocka', 'a wristwatch', 'föremål'),
  c('glasogon', 'Glasögon', 'a pair of glasses', 'föremål'),
  c('fotboll', 'Fotboll', 'a football (soccer ball)', 'föremål'),
  c('flygplan', 'Flygplan', 'an airplane', 'föremål'),
  // Mat
  c('pizza', 'Pizza', 'a pizza', 'mat'),
  c('kottbullar', 'Köttbullar', 'Swedish meatballs', 'mat'),
  c('kanelbulle', 'Kanelbulle', 'a Swedish cinnamon bun', 'mat'),
  c('surstromming', 'Surströmming', 'surströmming, fermented Baltic herring', 'mat'),
  c('banan', 'Banan', 'a banana', 'mat'),
  c('apple', 'Äpple', 'an apple', 'mat'),
  c('glass', 'Glass', 'ice cream', 'mat'),
  c('kaffe', 'Kaffe', 'a cup of coffee', 'mat'),
  c('choklad', 'Choklad', 'a bar of chocolate', 'mat'),
  c('tacos', 'Tacos', 'tacos (Swedish Friday-night style)', 'mat'),
  c('sushi', 'Sushi', 'sushi', 'mat'),
  c('pannkaka', 'Pannkaka', 'a pancake', 'mat'),
  c('rakmacka', 'Räkmacka', 'a Swedish open shrimp sandwich', 'mat'),
  c('knackebrod', 'Knäckebröd', 'Swedish crispbread', 'mat'),
  c('lingon', 'Lingon', 'lingonberries', 'mat'),
  // Platser
  c('stockholm', 'Stockholm', 'Stockholm, the capital of Sweden', 'plats'),
  c('ikea', 'IKEA-varuhus', 'an IKEA store', 'plats'),
  c('bastu', 'Bastu', 'a sauna', 'plats'),
  c('strand', 'Stranden', 'a sandy beach', 'plats'),
  c('skogen', 'Skogen', 'a Swedish pine forest', 'plats'),
  c('everest', 'Mount Everest', 'Mount Everest', 'plats'),
  c('paris', 'Paris', 'Paris, France', 'plats'),
  c('manen', 'Månen', 'the Moon', 'plats'),
  c('sjukhus', 'Sjukhus', 'a hospital', 'plats'),
  c('skola', 'Skola', 'a school building', 'plats'),
  // World of Warcraft (all exist in the original Azeroth era)
  c('thrall', 'Thrall', 'Thrall, the orc Warchief of the Horde in World of Warcraft', 'wow'),
  c('jaina', 'Jaina Proudmoore', 'Jaina Proudmoore, the human archmage in World of Warcraft', 'wow'),
  c('arthas', 'Arthas / Lich King', 'Arthas Menethil, the Lich King in World of Warcraft lore', 'wow'),
  c('illidan', 'Illidan Stormrage', 'Illidan Stormrage, the night elf demon hunter in World of Warcraft lore', 'wow'),
  c('ragnaros', 'Ragnaros', 'Ragnaros the Firelord, the fire elemental raid boss of Molten Core in World of Warcraft', 'wow'),
  c('onyxia', 'Onyxia', 'Onyxia, the black dragon raid boss in World of Warcraft', 'wow'),
  c('murloc', 'Murloc', 'a murloc, the gurgling fish-man creature in World of Warcraft', 'wow'),
  c('hogger', 'Hogger', 'Hogger, the infamous gnoll elite in Elwynn Forest, World of Warcraft', 'wow'),
  c('stormwind', 'Stormwind', 'Stormwind City, the human capital in World of Warcraft', 'wow'),
  c('orgrimmar', 'Orgrimmar', 'Orgrimmar, the orc capital city in World of Warcraft', 'wow'),
  c('moltencore', 'Molten Core', 'Molten Core, the lava-filled raid dungeon in World of Warcraft', 'wow'),
  c('hearthstone', 'Hearthstone (föremålet)', 'the Hearthstone item in World of Warcraft that teleports you to your inn', 'wow'),
  c('gryphon', 'Gryphon', 'a gryphon flight-path mount in World of Warcraft', 'wow'),
  c('gnome', 'Gnome', 'a gnome, the small tinkering race in World of Warcraft', 'wow'),
  c('leeroy', 'Leeroy Jenkins', 'Leeroy Jenkins, the famous World of Warcraft meme character', 'wow'),
  c('linken', 'Deviate Delight (fisk)', 'Deviate Fish / Savory Deviate Delight, the silly transforming food item in World of Warcraft', 'wow'),
];

export type Property = {
  id: string;
  /** Question shown to the player. */
  sv: string;
  /** Jev instruction; `thing` refers to the state field. */
  en: string;
  criteria?: { true?: string; false?: string };
};

const p = (id: string, sv: string, en: string, t?: string, f?: string): Property =>
  t || f ? { id, sv, en, criteria: { ...(t ? { true: t } : {}), ...(f ? { false: f } : {}) } } : { id, sv, en };

export const PROPERTIES: readonly Property[] = [
  p('alive', 'Är det levande?', 'Is `thing` a living being (an animal, plant, person or living character)?', 'It is alive or a living creature/character', 'It is an object, food, place or otherwise not alive'),
  p('animal', 'Är det ett djur?', 'Is `thing` an animal or animal-like creature?'),
  p('edible', 'Kan man äta det?', 'Is `thing` normally eaten or drunk by people?'),
  p('place', 'Är det en plats man kan vara på?', 'Is `thing` a place or location you can be at or visit?'),
  p('wow', 'Kommer det från World of Warcraft?', 'Does `thing` come from the video game World of Warcraft?'),
  p('bigger', 'Är det större än en människa?', 'Is `thing` physically bigger than an adult human?', 'Clearly larger than a person', 'Same size or smaller than a person'),
  p('pocket', 'Får det plats i en ficka?', 'Would a typical `thing` fit in a trouser pocket?'),
  p('fly', 'Kan det flyga?', 'Can `thing` fly or travel through the air?'),
  p('water', 'Finns det i vatten?', 'Does `thing` live in, or is it mostly found in, water?'),
  p('fur', 'Har det päls?', 'Does `thing` have fur or hair covering its body?'),
  p('dangerous', 'Kan det vara farligt?', 'Could `thing` seriously hurt a person?'),
  p('manmade', 'Är det tillverkat av människor?', 'Is `thing` made or built by humans (or by characters in a game world)?'),
  p('electric', 'Behöver det el?', 'Does `thing` need electricity or batteries to work?'),
  p('sweden', 'Hittar man det i Sverige?', 'Can you find `thing` in Sweden in real life?'),
  p('home', 'Finns det i ett vanligt hem?', 'Is `thing` typically found inside an ordinary home?'),
  p('sweet', 'Smakar det sött?', 'Does `thing` taste sweet?', 'It is food/drink with a clearly sweet taste', 'Not sweet, or not something you taste'),
  p('hot', 'Är det varmt?', 'Is `thing` usually hot (warm to the touch, served hot, or a hot place)?'),
  p('red', 'Är det ofta rött?', 'Is `thing` usually red or reddish?'),
  p('green', 'Är det ofta grönt?', 'Is `thing` usually green?'),
  p('legs', 'Har det fler än två ben?', 'Does `thing` have more than two legs?'),
  p('pet', 'Kan det vara ett husdjur?', 'Is `thing` commonly kept as a pet?'),
  p('fun', 'Används det mest för nöjes skull?', 'Is `thing` mainly used or enjoyed for fun or entertainment?'),
  p('wheels', 'Har det hjul?', 'Does `thing` have wheels?'),
  p('metal', 'Är det gjort av metall?', 'Is `thing` mostly made of metal?'),
  p('cold', 'Förknippas det med kyla?', 'Is `thing` associated with cold, ice or snow?'),
  p('magic', 'Har det med magi att göra?', 'Is `thing` associated with magic or supernatural powers?'),
  p('weapon', 'Kan det användas som vapen?', 'Is `thing` a weapon or commonly used as one?'),
  p('night', 'Förknippas det med natten?', 'Is `thing` strongly associated with night-time?'),
  p('ancient', 'Har det funnits i över tusen år?', 'Has `thing` (as a kind of thing) existed for more than a thousand years in the real world?'),
  p('character', 'Är det en namngiven person eller karaktär?', 'Is `thing` a specific named person or character?'),
  p('loud', 'Låter det mycket?', 'Is `thing` typically loud or noisy?'),
  p('soft', 'Är det mjukt?', 'Is `thing` soft to the touch?'),
];
