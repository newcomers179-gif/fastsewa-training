/**
 * Demo data for development and staging: four accounts and a few SAMPLE courses.
 *
 *   npm run seed
 *
 * Safe to re-run (existing rows are left alone). It refuses to run when
 * NODE_ENV=production unless ALLOW_DEMO_SEED=true is set on purpose.
 *
 * Passwords are random and printed once — no account with a published default
 * password ever exists (the old seed created admin / Admin@1234 and friends).
 *
 * The sample lessons are generic illustrations for testing the app. They are
 * NOT reviewed training material: titles say "(Sample)" so they cannot be mistaken
 * for approved content. Replace them through the admin console with material
 * approved by your safety officer / subject-matter expert before real use.
 *
 * Video lessons are only created when SEED_VIDEO_URL (a YouTube link) is given,
 * so the seed never ships a link that might be dead.
 */
import { eq } from "drizzle-orm";
import { courses, lessons, modules, quizQuestions, quizzes, users } from "../shared/schema";
import { closeDatabase, db } from "../server/db";
import { config } from "../server/config";
import { hashPassword } from "../server/auth/password";
import { generateTemporaryPassword } from "../server/services/accounts";
import { parseYouTubeId } from "../shared/validation";

if (config.isProd && process.env.ALLOW_DEMO_SEED !== "true") {
  console.error("Refusing to seed demo data into a production database (set ALLOW_DEMO_SEED=true if you really mean it).");
  process.exit(1);
}

const sampleNote = "Sample content for testing — replace with approved training material.";
const created: { username: string; role: string; password: string }[] = [];

async function ensureUser(input: { username: string; displayName: string; role: "admin" | "trainer" | "worker"; lang: "en" | "hi"; phone?: string }) {
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, input.username)).limit(1);
  if (existing) return existing.id;
  const password = process.env.SEED_PASSWORD || generateTemporaryPassword(12);
  const [row] = await db
    .insert(users)
    .values({
      username: input.username,
      passwordHash: await hashPassword(password),
      displayName: input.displayName,
      role: input.role,
      preferredLang: input.lang,
      phoneNumber: input.phone ?? null,
      consentVersion: config.legal.consentVersion,
      consentAcceptedAt: new Date(),
    })
    .returning({ id: users.id });
  created.push({ username: input.username, role: input.role, password });
  return row.id;
}

type LessonSeed = Omit<typeof lessons.$inferInsert, "moduleId" | "sortOrder">;
type QuestionSeed = Omit<typeof quizQuestions.$inferInsert, "quizId" | "sortOrder">;

async function ensureCourse(
  adminId: string,
  course: Omit<typeof courses.$inferInsert, "createdBy">,
  tree: {
    title: string;
    titleHi?: string;
    description?: string;
    descriptionHi?: string;
    lessons: LessonSeed[];
    quiz?: { title: string; passingScore: number; questions: QuestionSeed[] };
  }[]
) {
  const [existing] = await db.select({ id: courses.id }).from(courses).where(eq(courses.slug, course.slug)).limit(1);
  if (existing) return false;

  const [row] = await db.insert(courses).values({ ...course, createdBy: adminId }).returning({ id: courses.id });
  for (const [mi, m] of tree.entries()) {
    const [mod] = await db
      .insert(modules)
      .values({ courseId: row.id, title: m.title, titleHi: m.titleHi, description: m.description, descriptionHi: m.descriptionHi, sortOrder: mi })
      .returning({ id: modules.id });
    if (m.lessons.length > 0) {
      await db.insert(lessons).values(m.lessons.map((l, li) => ({ ...l, moduleId: mod.id, sortOrder: li })));
    }
    if (m.quiz) {
      const [quiz] = await db.insert(quizzes).values({ moduleId: mod.id, title: m.quiz.title, passingScore: m.quiz.passingScore }).returning({ id: quizzes.id });
      await db.insert(quizQuestions).values(m.quiz.questions.map((q, qi) => ({ ...q, quizId: quiz.id, sortOrder: qi })));
    }
  }
  return true;
}

function optionalVideo(title: string, titleHi: string, seconds: number): LessonSeed[] {
  const url = process.env.SEED_VIDEO_URL;
  if (!url || !parseYouTubeId(url)) return [];
  return [
    {
      title,
      titleHi,
      contentType: "video",
      videoUrl: `https://www.youtube.com/watch?v=${parseYouTubeId(url)}`,
      videoProvider: "youtube",
      videoDurationSeconds: Number(process.env.SEED_VIDEO_SECONDS) > 0 ? Number(process.env.SEED_VIDEO_SECONDS) : seconds,
      isRequired: true,
    },
  ];
}

async function seed() {
  console.log("🌱  Seeding sample data…\n");

  const adminId = await ensureUser({ username: "admin", displayName: "Site Admin", role: "admin", lang: "en" });
  await ensureUser({ username: "trainer1", displayName: "Suresh Trainer", role: "trainer", lang: "en", phone: "+919876500001" });
  await ensureUser({ username: "ramesh", displayName: "Ramesh Kumar", role: "worker", lang: "hi", phone: "+919876543210" });
  await ensureUser({ username: "priya", displayName: "Priya Sharma", role: "worker", lang: "en", phone: "+919876543211" });

  const safety = await ensureCourse(
    adminId,
    {
      slug: "construction-site-safety",
      title: "Construction Site Safety (Sample)",
      titleHi: "निर्माण स्थल सुरक्षा (नमूना)",
      description: `Everyday safety habits on a construction site: PPE and fire safety. ${sampleNote}`,
      descriptionHi: "निर्माण स्थल पर रोज़मर्रा की सुरक्षा आदतें: PPE और अग्नि सुरक्षा। (नमूना सामग्री — मान्य प्रशिक्षण सामग्री से बदलें)",
      category: "safety",
      difficulty: "beginner",
      durationMinutes: 30,
      isPublished: true,
      sortOrder: 1,
    },
    [
      {
        title: "Personal Protective Equipment (PPE)",
        titleHi: "व्यक्तिगत सुरक्षा उपकरण (PPE)",
        description: "What to wear, and how to check it before use.",
        descriptionHi: "क्या पहनें और उपयोग से पहले कैसे जांचें।",
        lessons: [
          ...optionalVideo("Introduction to PPE", "PPE का परिचय", 420),
          {
            title: "Safety helmets",
            titleHi: "सुरक्षा हेलमेट",
            contentType: "text",
            content:
              "A helmet protects your head from falling objects, bumps and (if rated for it) electrical contact.\n\n### Helmet classes (ANSI/ISEA Z89.1)\n- **Class G** (General): tested to 2,200 V, some electrical protection\n- **Class E** (Electrical): tested to 20,000 V, higher electrical protection\n- **Class C** (Conductive): not tested for electricity, **no** electrical protection\n\nCheck the label inside your helmet and follow your site's rules (in India, helmets are made to IS 2925).\n\n### Check before every shift\n- No cracks, dents or deep scratches in the shell\n- Straps and suspension intact\n- Do not paint or stick things over the shell\n- After a hard impact or a fall, stop using it and ask for a replacement — damage is often invisible\n\n> **No helmet, no entry on the active site.**",
            contentHi:
              "हेलमेट गिरती वस्तुओं और टक्कर से सिर को बचाता है।\n\n### हेलमेट वर्ग (ANSI/ISEA Z89.1)\n- **Class G**: सामान्य, 2,200 V तक परीक्षित\n- **Class E**: बिजली के काम के लिए, 20,000 V तक परीक्षित\n- **Class C**: बिजली से कोई सुरक्षा नहीं\n\nहेलमेट के अंदर का लेबल देखें और साइट के नियम मानें।\n\n### हर शिफ्ट से पहले जांचें\n- खोल में दरार या गहरी खरोंच न हो\n- पट्टे और अंदर की जाली ठीक हों\n- तेज़ झटके या ऊँचाई से गिरने के बाद उसे बदलवाएं\n\n> **हेलमेट नहीं, तो सक्रिय साइट में प्रवेश नहीं।**",
            isRequired: true,
          },
          {
            title: "Safety footwear and high-visibility vests",
            titleHi: "सुरक्षा जूते और हाई-विज़ वेस्ट",
            contentType: "text",
            content:
              "## Safety footwear\n\nProtective boots help against falling objects, nails and slippery floors. Check the sole for holes and keep laces tied.\n\n## High-visibility vest\n\nWear it over your outer layer wherever vehicles or machines move. Replace it when it is torn, faded or the reflective strips are damaged.",
            contentHi:
              "## सुरक्षा जूते\n\nसुरक्षा जूते भारी वस्तुओं, कीलों और फिसलन से बचाते हैं। तलवे में छेद न हो और फीते बंधे हों।\n\n## हाई-विज़ वेस्ट\n\nजहाँ गाड़ियाँ या मशीनें चलती हैं वहाँ ऊपर से पहनें। फटने या फीकी होने पर बदलें।",
            isRequired: true,
          },
        ],
        quiz: {
          title: "PPE knowledge check",
          passingScore: 70,
          questions: [
            {
              question: "Which helmet class (ANSI/ISEA Z89.1) is tested to 20,000 V?",
              questionHi: "कौन सा हेलमेट वर्ग (ANSI/ISEA Z89.1) 20,000 V तक परीक्षित है?",
              options: ["Class G", "Class E", "Class C", "None of them"],
              optionsHi: ["Class G", "Class E", "Class C", "कोई नहीं"],
              correctIndex: 1,
              explanation: "Class E (Electrical) helmets are tested to 20,000 V. Class G to 2,200 V; Class C gives no electrical protection.",
              explanationHi: "Class E हेलमेट 20,000 V तक परीक्षित हैं। Class G 2,200 V तक; Class C बिजली से सुरक्षा नहीं देता।",
            },
            {
              question: "Your helmet falls from a height onto concrete. What should you do?",
              questionHi: "आपका हेलमेट ऊँचाई से कंक्रीट पर गिर जाता है। आप क्या करेंगे?",
              options: ["Keep using it if it looks fine", "Glue any crack and carry on", "Use it only for office work", "Stop using it and get it replaced"],
              optionsHi: ["ठीक दिखे तो उपयोग जारी रखें", "दरार चिपकाकर काम चलाएं", "केवल ऑफिस के काम में उपयोग करें", "उपयोग बंद करें और बदलवाएं"],
              correctIndex: 3,
              explanation: "Internal damage is often invisible. A helmet that took a hard impact should be replaced.",
              explanationHi: "अंदरूनी नुकसान अक्सर दिखता नहीं। तेज़ झटका खाया हेलमेट बदल देना चाहिए।",
            },
            {
              question: "A high-visibility vest should be replaced when:",
              questionHi: "हाई-विज़ वेस्ट कब बदलनी चाहिए?",
              options: ["Every Monday", "After every use", "It is torn, faded or its reflective strips are damaged", "Only when a supervisor asks"],
              optionsHi: ["हर सोमवार", "हर उपयोग के बाद", "फटने, फीकी होने या परावर्तक पट्टियाँ खराब होने पर", "केवल सुपरवाइज़र के कहने पर"],
              correctIndex: 2,
              explanation: "A vest only works if it can be seen: replace it when it is torn, faded or the strips are damaged.",
              explanationHi: "वेस्ट तभी काम करती है जब दिखे: फटने, फीकी होने या पट्टियाँ खराब होने पर बदलें।",
            },
          ],
        },
      },
      {
        title: "Fire safety",
        titleHi: "अग्नि सुरक्षा",
        description: "Preventing fires and what to do if one starts.",
        descriptionHi: "आग रोकना और लगने पर क्या करें।",
        lessons: [
          {
            title: "The fire triangle and prevention",
            titleHi: "अग्नि त्रिकोण और रोकथाम",
            contentType: "text",
            content:
              "## The fire triangle\n\nA fire needs **fuel**, **oxygen** and **heat**. Take away any one and it goes out.\n\n## Prevention on site\n- Keep flammable material in a designated, ventilated place\n- Keep work areas free of rubbish\n- Smoke only in marked areas\n- Report damaged electrical equipment at once\n- Never block a fire exit",
            contentHi:
              "## अग्नि त्रिकोण\n\nआग के लिए **ईंधन**, **ऑक्सीजन** और **गर्मी** चाहिए। कोई एक हटाएं तो आग बुझ जाती है।\n\n## साइट पर रोकथाम\n- ज्वलनशील सामान निर्धारित हवादार जगह रखें\n- काम की जगह कचरा न रहने दें\n- धूम्रपान केवल निर्धारित जगह करें\n- खराब बिजली उपकरण तुरंत बताएं\n- अग्नि निकास कभी बंद न करें",
            isRequired: true,
          },
          ...optionalVideo("Using a fire extinguisher (PASS)", "अग्निशामक का उपयोग (PASS)", 180),
        ],
        quiz: {
          title: "Fire safety quiz",
          passingScore: 70,
          questions: [
            {
              question: "Which three things does a fire need?",
              questionHi: "आग के लिए कौन-सी तीन चीज़ें चाहिए?",
              options: ["Fuel, oxygen, heat", "Wood, water, wind", "Smoke, spark, gas", "Heat, light, noise"],
              optionsHi: ["ईंधन, ऑक्सीजन, गर्मी", "लकड़ी, पानी, हवा", "धुआँ, चिंगारी, गैस", "गर्मी, रोशनी, शोर"],
              correctIndex: 0,
              explanation: "Fuel, oxygen and heat make the fire triangle; removing one stops the fire.",
              explanationHi: "ईंधन, ऑक्सीजन और गर्मी अग्नि त्रिकोण बनाते हैं; एक हटाने से आग रुक जाती है।",
            },
            {
              question: "What must you never do with a fire exit?",
              questionHi: "अग्नि निकास के साथ क्या कभी नहीं करना चाहिए?",
              options: ["Keep it clear", "Block it", "Mark it", "Light it"],
              optionsHi: ["साफ रखना", "रास्ता रोकना", "निशान लगाना", "रोशन रखना"],
              correctIndex: 1,
              explanation: "A blocked exit can trap people in an emergency.",
              explanationHi: "बंद निकास आपात स्थिति में लोगों को फँसा सकता है।",
            },
          ],
        },
      },
    ]
  );

  const tools = await ensureCourse(
    adminId,
    {
      slug: "hand-tools-basics",
      title: "Hand Tools Basics (Sample)",
      titleHi: "हाथ के औज़ार — बुनियादी (नमूना)",
      description: `Choosing, using and looking after common hand tools. ${sampleNote}`,
      descriptionHi: "सामान्य हाथ के औज़ार चुनना, चलाना और संभालना। (नमूना सामग्री)",
      category: "tools",
      difficulty: "beginner",
      durationMinutes: 20,
      isPublished: true,
      sortOrder: 2,
    },
    [
      {
        title: "Basic hand tools",
        titleHi: "बुनियादी हाथ के औज़ार",
        lessons: [
          {
            title: "Hammers: types and safe use",
            titleHi: "हथौड़े: प्रकार और सुरक्षित उपयोग",
            contentType: "text",
            content:
              "## Hammers\n\n- **Claw hammer**: nailing and pulling nails\n- **Sledgehammer**: breaking concrete or masonry\n- **Rubber mallet**: fitting parts without marking them\n\n### Safe use\n- Check the handle for cracks before each use\n- Never use a hammer with a loose head\n- Wear safety glasses; chips can fly\n- Keep other people out of your swing area",
            contentHi:
              "## हथौड़े\n\n- **क्लॉ हैमर**: कील ठोकना/निकालना\n- **स्लेजहैमर**: कंक्रीट या चिनाई तोड़ना\n- **रबर मैलेट**: निशान डाले बिना फिटिंग\n\n### सुरक्षित उपयोग\n- हर बार हैंडल में दरार जांचें\n- ढीले सिर वाला हथौड़ा न चलाएं\n- सुरक्षा चश्मा पहनें\n- अपने स्विंग क्षेत्र से दूसरों को दूर रखें",
            isRequired: true,
          },
          {
            title: "Storing and maintaining tools",
            titleHi: "औज़ारों का रखरखाव",
            contentType: "text",
            content: "## Storage\n- Clean tools after use\n- Store them dry and locked\n- Never leave tools on scaffolding or edges\n\n## Maintenance\n- Replace worn handles\n- Sharpen only with proper equipment\n- Discard a tool that cannot be repaired safely",
            contentHi: "## भंडारण\n- उपयोग के बाद साफ करें\n- सूखी, बंद जगह रखें\n- मचान या किनारे पर औज़ार न छोड़ें\n\n## रखरखाव\n- घिसे हैंडल बदलें\n- सही उपकरण से ही धार लगाएं",
            isRequired: true,
          },
        ],
        quiz: {
          title: "Hand tools quiz",
          passingScore: 70,
          questions: [
            {
              question: "Before using a hammer you should:",
              questionHi: "हथौड़ा चलाने से पहले:",
              options: ["Paint it", "Check the handle for cracks and that the head is tight", "Soak it in water", "Weigh it"],
              optionsHi: ["उसे रंगें", "हैंडल की दरार और सिर का कसाव जांचें", "पानी में भिगोएं", "तौलें"],
              correctIndex: 1,
              explanation: "A cracked handle or loose head can fail mid-swing and cause serious injury.",
              explanationHi: "टूटा हैंडल या ढीला सिर चलाते समय निकल सकता है और गंभीर चोट दे सकता है।",
            },
          ],
        },
      },
    ]
  );

  const drafts = await ensureCourse(
    adminId,
    {
      slug: "construction-basics",
      title: "Construction Basics (Draft)",
      titleHi: "निर्माण बुनियादी (ड्राफ़्ट)",
      description: "A draft course that only staff can see — used to try the editor.",
      descriptionHi: "ड्राफ़्ट कोर्स जो केवल स्टाफ को दिखता है।",
      category: "basics",
      difficulty: "beginner",
      durationMinutes: 0,
      isPublished: false,
      sortOrder: 3,
    },
    []
  );

  console.log(`✅  Courses: safety ${safety ? "created" : "already there"}, tools ${tools ? "created" : "already there"}, draft ${drafts ? "created" : "already there"}`);
  if (created.length > 0) {
    console.log("\n🔐  Accounts created — these passwords are shown ONCE:");
    for (const c of created) console.log(`    ${c.username.padEnd(10)} ${c.role.padEnd(8)} ${c.password}`);
  } else {
    console.log("\n(accounts already existed; no passwords changed)");
  }
  console.log("\n⚠️   Sample content only. Replace it with approved training material before real use.\n");
}

seed()
  .then(() => closeDatabase())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error("\n❌  Seed failed:", error);
    await closeDatabase().catch(() => undefined);
    process.exit(1);
  });
