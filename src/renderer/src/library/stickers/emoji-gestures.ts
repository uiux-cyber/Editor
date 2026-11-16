import type { StickerDef } from '../types';
import { emojiIn, gendered } from './_lib/emoji';

const e = emojiIn('gestures');
const g = (base: string, name: string, keywords: string): StickerDef[] => gendered('gestures', base, name, keywords);

const stickers: StickerDef[] = [
  // Open hands
  e('👋', 'Waving Hand', 'wave hello hi bye goodbye'),
  e('🤚', 'Raised Back Of Hand', 'hand stop back raised'),
  e('🖐️', 'Hand With Fingers Splayed', 'hand five stop palm high-five'),
  e('✋', 'Raised Hand', 'stop hand high-five halt palm'),
  e('🖖', 'Vulcan Salute', 'spock trek salute prosper'),
  e('🫱', 'Rightwards Hand', 'hand right offer reach'),
  e('🫲', 'Leftwards Hand', 'hand left offer reach'),
  e('🫳', 'Palm Down Hand', 'drop dismiss palm down'),
  e('🫴', 'Palm Up Hand', 'offer give catch palm up'),
  // Fingers
  e('👌', 'OK Hand', 'ok okay perfect good nice'),
  e('🤌', 'Pinched Fingers', 'italian chef-kiss what gesture'),
  e('🤏', 'Pinching Hand', 'small tiny little bit pinch'),
  e('✌️', 'Victory Hand', 'peace victory two v'),
  e('🤞', 'Crossed Fingers', 'luck hope fingers-crossed wish'),
  e('🫰', 'Hand With Index Finger And Thumb Crossed', 'finger heart love money snap'),
  e('🤟', 'Love-You Gesture', 'love ily rock hand'),
  e('🤘', 'Sign Of The Horns', 'rock metal horns concert'),
  e('🤙', 'Call Me Hand', 'call shaka hang-loose phone'),
  e('👈', 'Backhand Index Pointing Left', 'point left this that finger'),
  e('👉', 'Backhand Index Pointing Right', 'point right this that finger'),
  e('👆', 'Backhand Index Pointing Up', 'point up above this finger'),
  e('👇', 'Backhand Index Pointing Down', 'point down below link finger'),
  e('☝️', 'Index Pointing Up', 'one point up wait finger'),
  e('🫵', 'Index Pointing At The Viewer', 'you point finger chosen'),
  // Fists and thumbs
  e('👍', 'Thumbs Up', 'like yes good approve ok'),
  e('👎', 'Thumbs Down', 'dislike no bad boo reject'),
  e('✊', 'Raised Fist', 'fist power solidarity strong'),
  e('👊', 'Oncoming Fist', 'punch fist bump hit'),
  e('🤛', 'Left-Facing Fist', 'fist bump left punch'),
  e('🤜', 'Right-Facing Fist', 'fist bump right punch'),
  // Two hands
  e('👏', 'Clapping Hands', 'clap applause bravo congrats well-done'),
  e('🙌', 'Raising Hands', 'hooray praise celebrate yay hands-up'),
  e('🫶', 'Heart Hands', 'love heart hands care support'),
  e('👐', 'Open Hands', 'open hug jazz hands'),
  e('🤲', 'Palms Up Together', 'pray dua cupped offer receive'),
  e('🤝', 'Handshake', 'deal agree partnership shake meeting'),
  e('🙏', 'Folded Hands', 'pray please thanks namaste hope'),
  // Hand actions
  e('✍️', 'Writing Hand', 'write sign note pen author'),
  e('💅', 'Nail Polish', 'nails manicure sassy beauty slay'),
  e('🤳', 'Selfie', 'selfie phone camera photo'),
  e('💪', 'Flexed Biceps', 'strong muscle gym power flex'),
  e('🦾', 'Mechanical Arm', 'robot prosthetic strong cyborg arm'),
  e('🦿', 'Mechanical Leg', 'robot prosthetic leg cyborg'),
  // Body parts
  e('🦵', 'Leg', 'leg kick limb knee'),
  e('🦶', 'Foot', 'foot kick stomp toes'),
  e('👂', 'Ear', 'ear listen hear sound'),
  e('🦻', 'Ear With Hearing Aid', 'hearing aid deaf accessibility ear'),
  e('👃', 'Nose', 'nose smell sniff scent'),
  e('🧠', 'Brain', 'brain smart mind think genius'),
  e('🫀', 'Anatomical Heart', 'heart organ cardio pulse real'),
  e('🫁', 'Lungs', 'lungs breath breathe organ'),
  e('🦷', 'Tooth', 'tooth dentist teeth dental'),
  e('🦴', 'Bone', 'bone skeleton dog fossil'),
  e('👀', 'Eyes', 'eyes look see watch stare'),
  e('👁️', 'Eye', 'eye see look watch vision'),
  e('👅', 'Tongue', 'tongue taste lick silly'),
  e('👄', 'Mouth', 'mouth lips kiss speak'),
  e('🫦', 'Biting Lip', 'lip bite flirt nervous anxious'),
  e('👣', 'Footprints', 'footprints steps walk track feet'),
  // Person gestures
  ...g('🙍', 'Person Frowning', 'frown sad upset disappointed'),
  ...g('🙎', 'Person Pouting', 'pout annoyed grumpy sulk'),
  ...g('🙅', 'Person Gesturing No', 'no stop forbidden nope x'),
  ...g('🙆', 'Person Gesturing OK', 'ok yes fine approve circle'),
  ...g('💁', 'Person Tipping Hand', 'sassy info help whatever'),
  ...g('🙋', 'Person Raising Hand', 'me question hello volunteer hand-up'),
  ...g('🧏', 'Deaf Person', 'deaf hear listen accessibility'),
  ...g('🙇', 'Person Bowing', 'bow sorry thanks respect apology'),
  ...g('🤦', 'Person Facepalming', 'facepalm ugh disbelief smh fail'),
  ...g('🤷', 'Person Shrugging', 'shrug dunno idk whatever maybe'),
];

export default stickers;
