/**
 * Words for generated designs. Each set is a coherent piece of content for one kind of video
 * (a launch, an event, a channel intro…), so a design reads like a finished piece, not a lorem
 * ipsum. `accent` is a word of `title` that designs may set apart.
 */

import type { TemplateCategory } from '../../types';

export interface Copy {
  /** Short name of the piece (used in the design's name). */
  label: string;
  kicker: string;
  title: string;
  accent: string;
  sub: string;
  cta: string;
  /** Big number / price / stat and what it means. */
  number: string;
  numberLabel: string;
  /** Small information lines (date, place, handle, site…). */
  meta: string[];
  /** Person or brand. */
  name: string;
  /** Three short points (features, chapters, steps). */
  points: string[];
}

type Bank = Partial<Record<TemplateCategory, Copy[]>>;

const c = (label: string, kicker: string, title: string, accent: string, sub: string, cta: string, number: string, numberLabel: string, meta: string[], name: string, points: string[]): Copy => ({
  label,
  kicker,
  title,
  accent,
  sub,
  cta,
  number,
  numberLabel,
  meta,
  name,
  points,
});

export const COPY: Bank = {
  intro: [
    c(
      'Studio Opener',
      'Welcome to',
      'Behind the Lens',
      'Lens',
      'Stories from people who make things',
      'Watch now',
      '04',
      'Episode',
      ['New episodes every Friday', '@behindthelens'],
      'Behind the Lens',
      ['Ideas', 'Process', 'People'],
    ),
    c('Channel Intro', 'Season two', 'Make It Simple', 'Simple', 'Design, code and everything between', 'Subscribe', '02', 'Season', ['Every Tuesday', 'makeitsimple.tv'], 'Nora Vale', [
      'Learn',
      'Build',
      'Share',
    ]),
    c('Podcast Open', 'The podcast', 'Quiet Hours', 'Quiet', 'Long conversations for loud times', 'Listen in', '58', 'Episode', ['With Sam Ortiz', 'Available everywhere'], 'Sam Ortiz', [
      'Culture',
      'Work',
      'Life',
    ]),
    c('Series Opener', 'A new series', 'Field Notes', 'Field', 'Small discoveries from big cities', 'Start watching', '01', 'Chapter', ['Filmed in Lisbon', '@fieldnotes'], 'Field Notes', [
      'Walk',
      'Look',
      'Listen',
    ]),
    c('Show Intro', 'Tonight on', 'The Long Table', 'Table', 'Food, friends and the stories we share', 'Pull up a chair', '12', 'Guests', ['Sundays · 8 PM', 'thelongtable.co'], 'Maya Chen', [
      'Cook',
      'Talk',
      'Taste',
    ]),
    c('Creator Intro', 'Hi, I am', 'Alex Rivers', 'Rivers', 'I film the places maps forget', 'Follow along', '120K', 'Explorers', ['@alexrivers', 'New video weekly'], 'Alex Rivers', [
      'Travel',
      'Film',
      'Stories',
    ]),
  ],
  title: [
    c('Feature Title', 'Chapter one', 'The Shape of Light', 'Light', 'An essay in moving pictures', 'Begin', '01', 'Chapter', ['Written & directed by June Park', '2026'], 'June Park', [
      'Dawn',
      'Noon',
      'Dusk',
    ]),
    c(
      'Documentary Title',
      'A documentary',
      'After the Storm',
      'Storm',
      'One town, one year, one rebuild',
      'Watch the film',
      '365',
      'Days filmed',
      ['In cinemas 12.05', 'A film by Leo Hart'],
      'Leo Hart',
      ['Loss', 'Work', 'Hope'],
    ),
    c('Essay Title', 'Part three', 'Nothing Is Wasted', 'Wasted', 'How small habits compound', 'Keep watching', '03', 'Part', ['A visual essay', 'Narrated by Ana Ruiz'], 'Ana Ruiz', [
      'Start',
      'Repeat',
      'Grow',
    ]),
    c('Trip Title', 'Day one', 'North of Everything', 'North', 'Ten days in the Faroe Islands', 'Come along', '10', 'Days', ['Faroe Islands', 'Shot on 16mm'], 'Ida Berg', ['Wind', 'Water', 'Stone']),
    c('Talk Title', 'Keynote', 'Designing for Calm', 'Calm', 'What the next decade of software feels like', 'Join the talk', '45', 'Minutes', ['Hall B · 10:30', 'Rae Collins'], 'Rae Collins', [
      'Less',
      'Slower',
      'Kinder',
    ]),
    c('Short Film Title', 'A short film', 'Paper Moon', 'Moon', 'Some promises are made to be kept', 'Now showing', '1996', 'Set in', ['Official selection', 'Running time 14 min'], 'Theo Lane', [
      'Night',
      'Road',
      'Home',
    ]),
  ],
  social: [
    c(
      'Hook Post',
      'Most people miss this',
      'Content That Captures Attention',
      'Attention',
      'Three rules we use on every post',
      'Save this',
      '3',
      'Rules',
      ['@studio.frame', 'Swipe for more'],
      'Studio Frame',
      ['Hook fast', 'Show proof', 'End with a why'],
    ),
    c(
      'Tip Post',
      'Quick tip',
      'Your Brand Is Not Your Logo',
      'Not',
      'It is every moment people spend with you',
      'Follow for more',
      '90%',
      'Of first impressions are visual',
      ['@brandnotes', 'Share with a founder'],
      'Brand Notes',
      ['Voice', 'Feeling', 'Promise'],
    ),
    c('Announcement', 'Big news', 'We Are Moving', 'Moving', 'Same people, brand new studio', 'Come say hi', '15.03', 'Opening day', ['Harbour Street 21', '@makershouse'], 'Makers House', [
      'More space',
      'Open studio',
      'Events',
    ]),
    c(
      'Question Post',
      'Be honest',
      'Ideas Are Not Created',
      'Created',
      'They are collected, connected and shaped',
      'Tell us below',
      '24',
      'Hours to try it',
      ['@thinkingroom', 'Comment your answer'],
      'Thinking Room',
      ['Notice', 'Connect', 'Shape'],
    ),
    c(
      'Behind the Scenes',
      'Behind the scenes',
      'How We Shoot a Campaign',
      'Campaign',
      'Two days, one van, too much coffee',
      'Watch the full story',
      '2',
      'Days on set',
      ['@northlight.studio', 'Full video on YouTube'],
      'Northlight',
      ['Plan', 'Shoot', 'Edit'],
    ),
    c('Milestone', 'Thank you', '100K Strong', 'Strong', 'We could not have done it without you', 'Celebrate with us', '100K', 'Followers', ['@dailycraft', 'Giveaway inside'], 'Daily Craft', [
      'Community',
      'Craft',
      'Gratitude',
    ]),
    c(
      'Myth Post',
      'Myth vs fact',
      'Strategy Without Content Is Noise',
      'Noise',
      'And content without strategy is luck',
      'Share this',
      '1',
      'Simple fix',
      ['@growthdesk', 'Part 4 of 10'],
      'Growth Desk',
      ['Know why', 'Plan what', 'Make it'],
    ),
  ],
  promo: [
    c(
      'Seasonal Sale',
      'End of season',
      'The Biggest Sale Ever',
      'Sale',
      'Everything must go, nothing held back',
      'Shop now',
      '50%',
      'Off everything',
      ['Online & in store', 'Ends Sunday'],
      'Loom & Co',
      ['Free shipping', 'Easy returns', 'New stock daily'],
    ),
    c('Product Launch', 'Introducing', 'Citrus Burst', 'Burst', 'Sparkling lemon, zero sugar, all sunshine', 'Taste it first', '0g', 'Sugar', ['Available now', 'citrusburst.com'], 'Citrus Burst', [
      'Real lemon',
      'Zero sugar',
      'Recyclable can',
    ]),
    c(
      'New Collection',
      'New collection',
      'Made for Slow Mornings',
      'Slow',
      'Soft linen, warm tones, honest prices',
      'Discover more',
      '24',
      'New pieces',
      ['Spring / Summer', 'atelier-nord.com'],
      'Atelier Nord',
      ['Linen', 'Organic cotton', 'Made in Portugal'],
    ),
    c('Flash Deal', 'Today only', 'Black Friday', 'Friday', 'Our best prices of the year', 'Grab the deal', '70%', 'Off selected items', ['Midnight to midnight', 'While stocks last'], 'Volt Store', [
      'Audio',
      'Cameras',
      'Gaming',
    ]),
    c(
      'App Launch',
      'Now available',
      'Budgeting Made Human',
      'Human',
      'See where your money goes, without the guilt',
      'Download free',
      '4.9',
      'App Store rating',
      ['iOS & Android', 'penny.app'],
      'Penny',
      ['Smart limits', 'Shared wallets', 'Monthly reports'],
    ),
    c('Coming Soon', 'Coming soon', 'Loop Deodorant', 'Loop', 'Refill once, reuse forever', 'Join the waitlist', '72h', 'Fresh', ['Launching March 1', 'loopcare.co'], 'Loop', [
      'Refillable',
      'Aluminium free',
      'Plastic free',
    ]),
    c(
      'Furniture Drop',
      'Just landed',
      'Sit Back, Stay Long',
      'Stay',
      'The lounge chair you will never give away',
      'Shop the chair',
      '£349',
      'Launch price',
      ['Free delivery', 'droem.design'],
      'Dröm',
      ['Oak frame', 'Wool seat', '10-year warranty'],
    ),
  ],
  youtube: [
    c(
      'Tutorial',
      'Tutorial',
      'Motion Graphics in Ten Minutes',
      'Ten',
      'From blank timeline to finished intro',
      'Like & subscribe',
      '10',
      'Minutes',
      ['Beginner friendly', 'Project files below'],
      'Kai Moreno',
      ['Setup', 'Animate', 'Export'],
    ),
    c('Challenge', 'New video', 'I Tried It for 30 Days', '30', 'Here is what actually changed', 'Watch till the end', '30', 'Days', ['Part 1', '@kaimoreno'], 'Kai Moreno', [
      'Week 1',
      'Week 2',
      'The result',
    ]),
    c('Review', 'Honest review', 'Worth the Hype?', 'Hype', 'Two months with the new camera', 'Full review', '8.5', 'Score', ['No sponsor', 'Links in description'], 'Gear Talk', [
      'Build',
      'Image',
      'Battery',
    ]),
    c(
      'Vlog Episode',
      'Episode 12',
      'Moving to the Mountains',
      'Mountains',
      'We packed everything and left the city',
      'Subscribe for part two',
      '12',
      'Episode',
      ['Slow living series', '@highplaces'],
      'High Places',
      ['Packing', 'The drive', 'First night'],
    ),
    c(
      'Explainer',
      'Explained',
      'Why Everything Is a Subscription',
      'Subscription',
      'The business model that ate the world',
      'Learn more',
      '$1.5T',
      'Market',
      ['Sources in description', 'Chapter list below'],
      'Plain Facts',
      ['History', 'Money', 'Future'],
    ),
  ],
  quote: [
    c('Simplicity', 'Thought of the day', 'Simplicity is the ultimate sophistication', 'sophistication', 'Leonardo da Vinci', 'Share', '1', 'Idea', ['@dailyquote'], 'Leonardo da Vinci', [
      'Less',
      'But',
      'Better',
    ]),
    c('Keep Going', 'Remember', 'The best way out is always through', 'through', 'Robert Frost', 'Share', '1', 'Line', ['@wordsworth.daily'], 'Robert Frost', ['Keep', 'Going', 'On']),
    c('Done Beats Perfect', 'Monday notes', 'Done is better than perfect', 'perfect', 'A note for the week', 'Save', '1', 'Rule', ['@makersnotes'], 'Makers Notes', ['Ship', 'Learn', 'Repeat']),
    c('Creative Fun', 'Words to work by', 'Creativity is intelligence having fun', 'fun', 'Often attributed to Albert Einstein', 'Share', '1', 'Spark', ['@ideaboard'], 'Idea Board', [
      'Play',
      'Try',
      'Wonder',
    ]),
    c('Less Design', 'On craft', 'Good design is as little design as possible', 'little', 'Dieter Rams', 'Save', '10', 'Principles', ['@lessbutbetter'], 'Dieter Rams', ['Useful', 'Honest', 'Lasting']),
    c('No Hurry', 'Slow down', 'Nature does not hurry, yet everything is accomplished', 'hurry', 'Lao Tzu', 'Share', '1', 'Breath', ['@stillness'], 'Lao Tzu', ['Breathe', 'Notice', 'Rest']),
  ],
  business: [
    c(
      'Company Profile',
      'About us',
      'Built for Teams That Ship',
      'Ship',
      'Planning, docs and releases in one place',
      'Book a demo',
      '12K',
      'Teams',
      ['Trusted worldwide', 'lineworks.app'],
      'Lineworks',
      ['Plan', 'Build', 'Launch'],
    ),
    c('Results', 'Year in review', 'Growth That Lasts', 'Lasts', 'Our results, and the people behind them', 'Read the report', '+148%', 'Revenue', ['FY 2026', 'Investor update'], 'Northwind', [
      'Revenue',
      'Retention',
      'Reach',
    ]),
    c('Hiring', 'We are hiring', 'Join the Studio', 'Studio', 'Designers, engineers and dreamers wanted', 'Apply today', '8', 'Open roles', ['Remote friendly', 'careers.atlas.io'], 'Atlas', [
      'Design',
      'Engineering',
      'Ops',
    ]),
    c(
      'Service Pitch',
      'What we do',
      'From Scrolls to Sales',
      'Sales',
      'Social content that brings customers, not just likes',
      'Get a proposal',
      '3x',
      'Average ROI',
      ['Since 2016', 'hello@scrollsales.co'],
      'Scroll & Sales',
      ['Strategy', 'Content', 'Ads'],
    ),
    c(
      'Real Estate',
      'Now acquiring',
      'Spaces That Work',
      'Work',
      'Offices, studios and homes in the city centre',
      'Schedule a visit',
      '42',
      'Properties',
      ['City centre', 'hoa-partners.com'],
      'HOA Partners',
      ['Offices', 'Studios', 'Homes'],
    ),
    c('Case Study', 'Case study', 'Redesigning a Bank', 'Bank', 'How 4 million customers got a calmer app', 'See the work', '4M', 'Customers', ['18 months', 'Brand · Product · Motion'], 'Fieldwork', [
      'Research',
      'Design',
      'Rollout',
    ]),
  ],
  event: [
    c('Music Night', 'Live music', 'Midnight Sessions', 'Midnight', 'Four bands, one rooftop, all night', 'Get tickets', '21', 'June', ['Doors 8 PM', 'The Roof · Berlin'], 'Midnight Sessions', [
      'Live sets',
      'Late bar',
      'Sunrise DJ',
    ]),
    c('Conference', 'Conference 2026', 'Design Systems Summit', 'Summit', 'Two days with the people who build the tools', 'Register now', '40+', 'Speakers', ['Sept 18–19', 'Amsterdam'], 'DSS', [
      'Talks',
      'Workshops',
      'Socials',
    ]),
    c('Exhibition', 'Exhibition', 'Less but Better', 'Better', 'A century of quiet design', 'Book your visit', '120', 'Objects', ['Until 30 August', 'Museum of Form'], 'Museum of Form', [
      'Furniture',
      'Radio',
      'Print',
    ]),
    c('Workshop', 'Hands-on workshop', 'Learn to Letter', 'Letter', 'Brush lettering for total beginners', 'Save your seat', '12', 'Seats', ['Saturday 10 AM', 'Paper Lab'], 'Paper Lab', [
      'Tools',
      'Strokes',
      'Words',
    ]),
    c('Festival', 'Summer festival', 'Sun Seekers', 'Sun', 'Three days of music by the sea', 'Early bird tickets', '3', 'Days', ['July 4–6', 'North Beach'], 'Sun Seekers', ['Music', 'Food', 'Sea']),
    c('Launch Party', 'You are invited', 'The Launch Party', 'Party', 'Celebrate the new collection with us', 'RSVP', '18', 'Nov', ['7 PM till late', 'Studio 9'], 'Studio 9', [
      'Drinks',
      'Music',
      'Preview',
    ]),
  ],
  outro: [
    c('End Screen', 'Thanks for watching', 'See You Next Time', 'Next', 'New videos every week', 'Subscribe', '01', 'Next up', ['@yourchannel', 'yourchannel.com'], 'Your Channel', [
      'Watch next',
      'Subscribe',
      'Share',
    ]),
    c('Credits', 'Thank you', 'That Is a Wrap', 'Wrap', 'Made with friends, coffee and patience', 'Follow for more', '24', 'Takes', ['Directed by Lee Ahn', 'Music by Wren'], 'Lee Ahn', [
      'Crew',
      'Cast',
      'You',
    ]),
    c('Closing', 'Until next time', 'Stay Curious', 'Curious', 'Keep asking better questions', 'Join the newsletter', '∞', 'Questions', ['@curious.club', 'curious.club'], 'Curious Club', [
      'Ask',
      'Learn',
      'Share',
    ]),
    c('Outro', 'Do not miss', 'The Next Episode', 'Next', 'Part two drops Friday', 'Turn on notifications', '02', 'Part', ['@studio.loop', 'Links below'], 'Studio Loop', [
      'Subscribe',
      'Comment',
      'Share',
    ]),
  ],
  vlog: [
    c('Day in the Life', 'A day in the life', 'An Ordinary Guy', 'Ordinary', 'Coffee, commute, a little chaos', 'Spend the day', '24', 'Hours', ['Tokyo', 'Vlog 031'], 'Ren Ito', [
      'Morning',
      'Work',
      'Night',
    ]),
    c('Travel Diary', 'Travel diary', 'Living Out Our Passion', 'Passion', 'Six weeks, one van, no plan', 'Ride along', '6', 'Weeks', ['Portugal → Morocco', '@vanlifediary'], 'Vanlife Diary', [
      'Coast',
      'Desert',
      'Mountains',
    ]),
    c('Weekend Vlog', 'Weekend', 'Slow Sunday', 'Slow', 'Farmers market, film camera, long lunch', 'Come with me', '36', 'Exposures', ['Copenhagen', 'Shot on 35mm'], 'Ella Moss', [
      'Market',
      'Lunch',
      'Golden hour',
    ]),
    c('City Guide', 'City guide', 'Tokyo After Dark', 'Dark', 'The places locals actually go', 'Save for your trip', '9', 'Spots', ['Shinjuku · Shibuya', 'Map in bio'], 'Night Walks', [
      'Food',
      'Bars',
      'Views',
    ]),
    c('Studio Vlog', 'Studio vlog', 'Rebuilt', 'Rebuilt', 'Three months turning a garage into a studio', 'Watch the build', '90', 'Days', ['Before & after', '@buildwithjo'], 'Jo Park', [
      'Demo',
      'Build',
      'Reveal',
    ]),
  ],
  news: [
    c(
      'Breaking',
      'Breaking',
      'Markets Rally on Rate Cut',
      'Rally',
      'Stocks climb to a six-month high',
      'Live coverage',
      '+3.2%',
      'Index today',
      ['14:05 GMT', 'Live from the newsroom'],
      'Morning Wire',
      ['Markets', 'Policy', 'Outlook'],
    ),
    c('Report', 'Report', 'The City That Went Car-Free', 'Car-Free', 'One year on, what changed', 'Read the report', '-41%', 'Traffic', ['Special report', 'citydesk.news'], 'City Desk', [
      'Air',
      'Streets',
      'Shops',
    ]),
    c('Update', 'Update', 'Storm Moves North Tonight', 'North', 'Coastal warnings remain in place', 'Stay safe', '120', 'km/h gusts', ['Updated 18:30', 'Weather desk'], 'Weather Desk', [
      'Wind',
      'Rain',
      'Travel',
    ]),
    c('Explainer', 'In focus', 'What the New Law Means', 'Law', 'Five things that change on Monday', 'Learn more', '5', 'Changes', ['Explainer', 'policy.today'], 'Policy Today', [
      'Work',
      'Housing',
      'Tax',
    ]),
  ],
};

/** Categories that have generated designs. */
export const GENERATED_CATEGORIES = Object.keys(COPY) as TemplateCategory[];

export function copyFor(category: TemplateCategory, n: number): Copy {
  const list = COPY[category] ?? COPY.title!;
  return list[((n % list.length) + list.length) % list.length];
}
