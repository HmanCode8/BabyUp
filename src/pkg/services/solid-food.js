/**
 * 辅食资料库：按月龄整理的食谱，纯本地数据，不依赖任何接口。
 *
 * 口径（与 services/parenting-knowledge.js 保持一致）：
 *   - 只讲「适宜月龄 / 食材 / 做法 / 质地 / 过敏怎么观察」，**不给克数与营养剂量**；
 *   - 内容属于日常照护参考，首次添加辅食、过敏体质、生长发育异常请咨询儿保医生。
 *
 * 为什么数据写死在代码里而不是建集合：内容不随用户变化，放本地省一次请求，
 * 也避免把「医疗健康」性质的内容落到云端（个人主体小程序的合规边界）。
 *
 * 加新食谱只改本文件：往 RECIPES 里追加一条，stage/category 从下面的枚举里挑。
 */

/** 月龄档：按宝宝的月龄命中一档，决定默认筛选 */
export const STAGES = [
  { key: 'm6', label: '6 月龄起', minMonths: 6, hint: '泥糊状，一天 1~2 次，奶仍是主食' },
  { key: 'm8', label: '8 月龄起', minMonths: 8, hint: '稠糊到小颗粒，一天约 2 次' },
  { key: 'm10', label: '10 月龄起', minMonths: 10, hint: '颗粒和小块，可以自己抓着吃' },
  { key: 'm12', label: '12 月龄起', minMonths: 12, hint: '接近大人餐次，切小块、少盐少糖' },
]

/** 主料分类：一道菜归一个类，方便「今天想给他吃点鱼」这种找法 */
export const CATEGORIES = [
  { key: 'staple', label: '谷薯' },
  { key: 'veg', label: '蔬菜' },
  { key: 'fruit', label: '水果' },
  { key: 'meat', label: '肉禽' },
  { key: 'fish', label: '鱼虾' },
  { key: 'egg', label: '蛋' },
  { key: 'bean', label: '豆制品' },
]

/** 卡片上的小标记（纯展示，不参与筛选） */
const TAG_LABELS = {
  first: '第一口',
  iron: '高铁',
  finger: '手指食物',
  allergen: '常见致敏',
  quick: '快手',
}

/**
 * 食谱清单。
 *
 * 每条的字段：
 *   stage      月龄档 key（STAGES 里的 key）
 *   category   主料分类 key（CATEGORIES 里的 key）
 *   texture    质地，直接给家长看的
 *   ingredients / steps / tips  食材、做法、注意点
 *   tags       卡片小标记（TAG_LABELS 的 key）
 */
export const RECIPES = [
  // ---------- 6 月龄起：泥糊状，一次只加一种新食物 ----------
  {
    id: 'rice-cereal',
    name: '铁强化米粉糊',
    stage: 'm6',
    category: 'staple',
    texture: '稀糊',
    tags: ['first', 'iron', 'quick'],
    ingredients: ['铁强化婴儿米粉', '温水（或母乳、配方奶）'],
    steps: [
      '米粉倒进干净的碗里，先少放一点',
      '边加温水边用勺子搅，调成能挂在勺子上、不会滴落的稠度',
      '第一口可以再稀一点，让宝宝先适应吞咽',
    ],
    tips: [
      '第一口辅食优先选铁强化米粉：6 月龄后母乳里的铁不够用了，铁是这段时间最该补的',
      '一次只加这一种新食物，连续吃 2~3 天，没有起疹子、拉肚子再加下一种',
    ],
  },
  {
    id: 'pumpkin-puree',
    name: '南瓜泥',
    stage: 'm6',
    category: 'veg',
    texture: '泥状',
    tags: ['quick'],
    ingredients: ['南瓜一小块'],
    steps: [
      '南瓜去皮去籽，切成薄片',
      '上锅蒸到用勺子一压就烂',
      '趁热压成泥，太干就加一点温水或母乳调开',
    ],
    tips: ['南瓜自带甜味，不用加糖；一次做多了可以分装冷冻，吃前彻底加热'],
  },
  {
    id: 'carrot-puree',
    name: '胡萝卜泥',
    stage: 'm6',
    category: 'veg',
    texture: '泥状',
    tags: [],
    ingredients: ['胡萝卜一小段'],
    steps: ['胡萝卜去皮切薄片', '蒸到软烂，筷子能轻松扎透', '压成泥，过筛一次口感更细'],
    tips: ['胡萝卜要蒸得比南瓜更久，没蒸透的胡萝卜泥容易噎'],
  },
  {
    id: 'broccoli-puree',
    name: '西兰花泥',
    stage: 'm6',
    category: 'veg',
    texture: '泥状',
    tags: [],
    ingredients: ['西兰花两三小朵'],
    steps: ['西兰花掰小朵，用流水冲干净', '只取花的部分上锅蒸软', '压成泥，粗的梗和渣不要'],
    tips: ['西兰花的花球容易藏脏东西，掰开后再冲一遍'],
  },
  {
    id: 'potato-mash',
    name: '土豆泥',
    stage: 'm6',
    category: 'staple',
    texture: '泥状',
    tags: [],
    ingredients: ['土豆半个'],
    steps: ['土豆去皮切块', '蒸到一压就散', '压成泥，加温水或母乳调到顺滑'],
    tips: ['发芽、皮发绿的土豆有毒素，直接扔掉'],
  },
  {
    id: 'sweet-potato-mash',
    name: '红薯泥',
    stage: 'm6',
    category: 'staple',
    texture: '泥状',
    tags: ['quick'],
    ingredients: ['红薯一小个'],
    steps: ['红薯去皮切厚片', '蒸到软烂', '压成泥，太稠就加点温水'],
    tips: ['红薯纤维多，第一次少给一点，吃多了容易胀气'],
  },
  {
    id: 'pork-liver-paste',
    name: '猪肝泥',
    stage: 'm6',
    category: 'meat',
    texture: '泥状',
    tags: ['iron'],
    ingredients: ['新鲜猪肝一小块', '姜一片'],
    steps: [
      '猪肝切片，用流水冲到没有血水',
      '加姜片上锅蒸熟，中间没有血色才算熟透',
      '趁热压成细泥，拌进米粉或粥里',
    ],
    tips: [
      '这是补铁很强的一样，但维生素 A 含量高，一周 1~2 次就够，不用天天吃',
      '肝脏一定要完全熟透',
    ],
  },
  {
    id: 'chicken-paste',
    name: '鸡肉泥',
    stage: 'm6',
    category: 'meat',
    texture: '泥状',
    tags: ['iron'],
    ingredients: ['鸡胸肉一小块', '姜一片'],
    steps: [
      '鸡胸肉去掉筋膜，切小块',
      '加姜片蒸熟',
      '加点蒸出来的汤一起打成泥，不然会很干',
    ],
    tips: ['肉泥一定要打到没有颗粒，拌进米粉或粥里更好咽'],
  },
  {
    id: 'apple-puree',
    name: '苹果泥',
    stage: 'm6',
    category: 'fruit',
    texture: '泥状',
    tags: ['quick'],
    ingredients: ['苹果半个'],
    steps: ['苹果去皮去核，切小块', '隔水蒸 5~10 分钟', '压成泥，温热时喂'],
    tips: ['第一次吃水果建议蒸一下，生的太凉也容易引起胀气；果汁不推荐，直接吃果泥更好'],
  },
  {
    id: 'avocado-mash',
    name: '牛油果泥',
    stage: 'm6',
    category: 'fruit',
    texture: '泥状',
    tags: ['quick'],
    ingredients: ['熟牛油果四分之一个'],
    steps: ['挑捏着有点软的牛油果，对半切开去核', '用勺子把果肉挖出来', '直接压成泥，太稠加一点母乳或温水'],
    tips: ['牛油果容易氧化变黑，现做现吃'],
  },

  // ---------- 8 月龄起：稠糊到小颗粒 ----------
  {
    id: 'tomato-yolk-rice',
    name: '番茄蛋黄米糊',
    stage: 'm8',
    category: 'egg',
    texture: '稠糊',
    tags: ['allergen', 'quick'],
    ingredients: ['番茄半个', '熟蛋黄一个', '铁强化米粉'],
    steps: [
      '番茄顶部划十字，用开水烫一下去皮，切碎',
      '蛋黄压碎',
      '米粉加水调开，拌入番茄碎和蛋黄',
    ],
    tips: [
      '蛋黄从四分之一个开始试，没有异常再给到一个',
      '鸡蛋是常见致敏食物，但不用刻意推迟，少量开始、观察 2~3 天就好',
    ],
  },
  {
    id: 'cod-potato-mash',
    name: '鳕鱼土豆泥',
    stage: 'm8',
    category: 'fish',
    texture: '稠泥',
    tags: ['allergen', 'iron'],
    ingredients: ['鳕鱼一小块', '土豆半个', '姜一片'],
    steps: [
      '鳕鱼解冻后擦干，加姜片蒸熟',
      '趁热把鱼肉拆下来，**用手指再摸一遍有没有刺**',
      '土豆蒸熟压泥，拌入鱼肉',
    ],
    tips: ['给鱼一定要拆刺并用手复查，这一步不能省'],
  },
  {
    id: 'spinach-liver-porridge',
    name: '菠菜猪肝粥',
    stage: 'm8',
    category: 'meat',
    texture: '稠粥',
    tags: ['iron'],
    ingredients: ['大米一小把', '猪肝一小块', '菠菜两片叶子'],
    steps: [
      '大米提前泡半小时，煮成软烂的稠粥',
      '猪肝冲净血水、蒸熟后压成泥',
      '菠菜焯水去草酸，切碎，和肝泥一起拌进粥里再煮 2 分钟',
    ],
    tips: ['菠菜先焯水再切，草酸会影响铁和钙的吸收'],
  },
  {
    id: 'yam-chicken-porridge',
    name: '山药鸡肉粥',
    stage: 'm8',
    category: 'meat',
    texture: '稠粥',
    tags: ['iron'],
    ingredients: ['大米一小把', '山药一小段', '鸡胸肉一小块'],
    steps: ['大米泡好煮粥', '山药去皮切小丁，鸡肉剁成末', '粥快好时下鸡肉末和山药丁，煮到都软烂'],
    tips: ['削山药皮会手痒，戴个手套或者用流水冲着削'],
  },
  {
    id: 'tofu-veg-soup',
    name: '豆腐蔬菜羹',
    stage: 'm8',
    category: 'bean',
    texture: '稠羹',
    tags: [],
    ingredients: ['嫩豆腐一小块', '青菜叶两片', '一点水淀粉'],
    steps: [
      '嫩豆腐用开水烫一下去豆腥，压碎',
      '青菜叶切得极碎',
      '加水煮开，勾一点点水淀粉让汤挂住，下豆腐和菜碎煮 2 分钟',
    ],
    tips: ['嫩豆腐比老豆腐更滑、更不容易噎，这个阶段优先用嫩豆腐'],
  },
  {
    id: 'banana-oat',
    name: '香蕉燕麦糊',
    stage: 'm8',
    category: 'staple',
    texture: '稠糊',
    tags: ['quick'],
    ingredients: ['即食燕麦片一小把', '香蕉半根'],
    steps: ['燕麦片用温水或奶泡软，煮 2 分钟', '香蕉用叉子压成泥', '拌在一起，稠度按宝宝接受度调'],
    tips: ['香蕉通便，要是这几天在拉肚子就先别给'],
  },
  {
    id: 'salmon-pumpkin-mash',
    name: '三文鱼南瓜泥',
    stage: 'm8',
    category: 'fish',
    texture: '稠泥',
    tags: ['allergen'],
    ingredients: ['三文鱼一小块', '南瓜一小块', '柠檬一片'],
    steps: ['三文鱼用柠檬片腌 5 分钟去腥，蒸熟', '仔细拆刺并用手复查', '南瓜蒸熟压泥，拌入鱼肉'],
    tips: ['三文鱼油脂多、口感好，是 8 月龄后很好的一餐'],
  },
  {
    id: 'beef-pumpkin-porridge',
    name: '牛肉南瓜粥',
    stage: 'm8',
    category: 'meat',
    texture: '稠粥',
    tags: ['iron'],
    ingredients: ['大米一小把', '牛里脊一小块', '南瓜一小块'],
    steps: [
      '牛里脊逆着纹路切，剁成很细的末',
      '南瓜蒸熟压泥',
      '粥煮到软烂，下牛肉末搅散煮 3 分钟，最后拌入南瓜泥',
    ],
    tips: ['牛肉末一定要剁细、彻底煮熟，红肉是补铁的好来源'],
  },
  {
    id: 'greens-yolk-noodle',
    name: '青菜蛋黄面',
    stage: 'm8',
    category: 'egg',
    texture: '软烂面',
    tags: ['allergen'],
    ingredients: ['婴儿细面一小把', '熟蛋黄一个', '青菜叶两片'],
    steps: ['面条掰成小段，煮到很软', '青菜叶焯水后切碎', '拌入压碎的蛋黄，再煮 1 分钟'],
    tips: ['面要煮到用勺子能切断，太筋道的面这个月龄嚼不动'],
  },
  {
    id: 'millet-pumpkin-porridge',
    name: '小米南瓜粥',
    stage: 'm8',
    category: 'staple',
    texture: '稠粥',
    tags: ['quick'],
    ingredients: ['小米一小把', '南瓜一小块'],
    steps: ['小米淘净，加水煮开转小火', '南瓜切小丁一起煮', '煮到小米开花、南瓜化在粥里'],
    tips: ['小米粥熬出的那层米油宝宝很喜欢，不用撇掉'],
  },

  // ---------- 10 月龄起：颗粒、小块、手指食物 ----------
  {
    id: 'shrimp-dumpling',
    name: '虾仁蔬菜小馄饨',
    stage: 'm10',
    category: 'fish',
    texture: '小块',
    tags: ['allergen'],
    ingredients: ['馄饨皮', '鲜虾几只', '青菜叶两片'],
    steps: [
      '虾去壳去虾线，和青菜一起剁成细末',
      '馄饨皮切成四分之一大小，包成小个',
      '水开下锅，煮到浮起来再多煮 2 分钟',
    ],
    tips: ['皮切小、馅剁细，一口一个不会噎；虾是常见致敏食物，第一次少给两只'],
  },
  {
    id: 'chicken-balls',
    name: '鸡肉小丸子',
    stage: 'm10',
    category: 'meat',
    texture: '软丸',
    tags: ['iron', 'finger'],
    ingredients: ['鸡胸肉一块', '蛋清一点', '淀粉一点'],
    steps: [
      '鸡肉剁成泥，加蛋清和淀粉顺一个方向搅上劲',
      '手上沾水，挤成小丸子',
      '水开后转小火下锅，浮起来再煮 3 分钟',
    ],
    tips: ['丸子做小一点，直径不要超过宝宝手指宽度，方便自己抓着吃'],
  },
  {
    id: 'pumpkin-pancake',
    name: '南瓜软饼',
    stage: 'm10',
    category: 'staple',
    texture: '软饼',
    tags: ['finger'],
    ingredients: ['南瓜泥', '面粉', '蛋黄一个'],
    steps: ['南瓜蒸熟压泥，加蛋黄和面粉调成能流动的糊', '不粘锅小火，不放油或少放一点', '一面定型后翻面，两面金黄即可'],
    tips: ['摊得薄一点更容易熟，切开成条状就是很好的手指食物'],
  },
  {
    id: 'steamed-carrot-sticks',
    name: '蒸胡萝卜条',
    stage: 'm10',
    category: 'veg',
    texture: '软条',
    tags: ['finger'],
    ingredients: ['胡萝卜一根'],
    steps: ['胡萝卜切成手指粗、约 5 厘米长的条', '上锅蒸到用筷子能轻松扎透', '放温了再给宝宝抓'],
    tips: ['必须蒸到一压就烂，生的或半生的胡萝卜条又硬又滑，是常见的噎呛来源'],
  },
  {
    id: 'broccoli-millet-rice',
    name: '西兰花小米软饭',
    stage: 'm10',
    category: 'veg',
    texture: '软饭',
    tags: [],
    ingredients: ['小米和大米各半', '西兰花两小朵'],
    steps: ['两种米一起煮成偏软的饭', '西兰花取花的部分，蒸熟后切碎', '拌进饭里，滴两滴食用油'],
    tips: ['软饭的水比平时多一点，比大人的饭更烂'],
  },
  {
    id: 'tomato-beef-noodle',
    name: '番茄牛肉碎拌面',
    stage: 'm10',
    category: 'meat',
    texture: '软面',
    tags: ['iron'],
    ingredients: ['婴儿面', '番茄一个', '牛里脊一小块'],
    steps: ['番茄去皮切碎，炒出汁', '牛肉剁成碎末下锅炒熟', '面条煮软后拌进去，收一下汁'],
    tips: ['番茄的酸味能盖住肉腥味，不爱吃肉的宝宝通常接受度更好'],
  },
  {
    id: 'banana-egg-pancake',
    name: '香蕉鸡蛋软饼',
    stage: 'm10',
    category: 'egg',
    texture: '软饼',
    tags: ['allergen', 'finger', 'quick'],
    ingredients: ['香蕉一根', '鸡蛋一个', '面粉一点'],
    steps: ['香蕉压成泥，加鸡蛋和面粉拌匀', '不粘锅小火，舀一勺摊成小圆饼', '两面定型就好，不用煎到上色'],
    tips: ['香蕉本身很甜，完全不用加糖'],
  },
  {
    id: 'fish-tofu-soup',
    name: '鱼肉豆腐羹',
    stage: 'm10',
    category: 'fish',
    texture: '滑羹',
    tags: ['allergen'],
    ingredients: ['鲈鱼肉一小块', '嫩豆腐一小块', '青菜叶一片'],
    steps: ['鱼肉蒸熟后拆刺、用手复查，撕成小碎块', '嫩豆腐压碎，青菜切碎', '加水煮开勾薄芡，全部下锅煮 2 分钟'],
    tips: ['羹的稠度靠薄芡挂住，比清汤更容易用勺子喂'],
  },
  {
    id: 'broccoli-potato-pattie',
    name: '西兰花土豆饼',
    stage: 'm10',
    category: 'veg',
    texture: '软饼',
    tags: ['finger'],
    ingredients: ['土豆一个', '西兰花两小朵', '淀粉一点'],
    steps: ['土豆蒸熟压泥，西兰花蒸熟切碎', '加淀粉拌匀，手上沾水压成小饼', '不粘锅小火两面煎定型'],
    tips: ['土豆泥要放凉一点再压饼，太烫会很黏手'],
  },
  {
    id: 'liver-spinach-noodle',
    name: '猪肝菠菜面',
    stage: 'm10',
    category: 'meat',
    texture: '软面',
    tags: ['iron'],
    ingredients: ['婴儿面', '猪肝一小块', '菠菜两片叶子'],
    steps: ['猪肝冲净血水，蒸熟后切碎', '菠菜焯水切碎', '面条煮软，下肝碎和菠菜再煮 1 分钟'],
    tips: ['还是那句：猪肝一周 1~2 次就够，别连着一周天天吃'],
  },

  // ---------- 12 月龄起：接近大人餐次，切小块、少盐少糖 ----------
  {
    id: 'tri-color-omelette',
    name: '三色蔬菜蛋饼',
    stage: 'm12',
    category: 'egg',
    texture: '软饼',
    tags: ['allergen', 'quick'],
    ingredients: ['鸡蛋一个', '胡萝卜、青菜、玉米粒各一点'],
    steps: ['蔬菜都切得很碎，胡萝卜和玉米先蒸软', '鸡蛋打散拌入蔬菜碎', '不粘锅小火摊成薄饼，切成长条'],
    tips: ['玉米粒要压扁或切碎，整粒的容易原样排出来，也有噎呛风险'],
  },
  {
    id: 'tomato-beef-pasta',
    name: '番茄牛肉意面',
    stage: 'm12',
    category: 'meat',
    texture: '软面',
    tags: ['iron'],
    ingredients: ['宝宝意面', '番茄一个', '牛肉末'],
    steps: ['意面煮到比大人吃的更软，剪成小段', '番茄去皮切碎炒出汁', '下牛肉末炒熟，拌入意面收汁'],
    tips: ['这一步可以开始用一点点番茄本身的味道提味，仍然不加盐'],
  },
  {
    id: 'steamed-bass-rice',
    name: '清蒸鲈鱼配软饭',
    stage: 'm12',
    category: 'fish',
    texture: '软块',
    tags: ['allergen'],
    ingredients: ['鲈鱼一段', '姜两片', '软饭一碗'],
    steps: ['鱼加姜片上锅蒸 8~10 分钟', '拆下鱼肉，用手仔细复查有没有刺', '配软饭一起吃，可以淋一点蒸鱼的汤汁'],
    tips: ['鱼腹靠近大骨的地方刺最少，给小月龄优先取那部分'],
  },
  {
    id: 'chicken-pumpkin-rice',
    name: '鸡肉南瓜焖饭',
    stage: 'm12',
    category: 'meat',
    texture: '软饭',
    tags: ['iron'],
    ingredients: ['大米', '鸡腿肉一小块', '南瓜一小块'],
    steps: ['鸡腿肉去骨切小丁，南瓜切丁', '和米一起下锅，水比平时多一点', '按下煮饭键，煮好后再焖 10 分钟'],
    tips: ['鸡腿肉比鸡胸嫩，一岁后可以开始给这种带点嚼头的肉'],
  },
  {
    id: 'tofu-greens-soup',
    name: '豆腐青菜羹',
    stage: 'm12',
    category: 'bean',
    texture: '滑羹',
    tags: ['quick'],
    ingredients: ['嫩豆腐', '青菜', '一点水淀粉'],
    steps: ['豆腐切小丁，青菜切碎', '水开下锅煮 3 分钟', '勾薄芡，放温再喂'],
    tips: ['豆腐切成的丁要小于宝宝指甲盖，避免整块吞'],
  },
  {
    id: 'shrimp-scrambled-egg',
    name: '虾仁滑蛋',
    stage: 'm12',
    category: 'fish',
    texture: '软块',
    tags: ['allergen', 'quick'],
    ingredients: ['鲜虾几只', '鸡蛋一个'],
    steps: ['虾去壳去虾线，切成小丁', '鸡蛋打散，加一点水让口感更嫩', '小火下蛋液和虾丁，半凝固就关火'],
    tips: ['火一定要小，蛋炒老了宝宝会嚼不动吐出来'],
  },
  {
    id: 'purple-yam-bun',
    name: '紫薯软馒头片',
    stage: 'm12',
    category: 'staple',
    texture: '软块',
    tags: ['finger'],
    ingredients: ['紫薯一个', '小馒头或吐司片'],
    steps: ['紫薯蒸熟压成泥', '均匀涂在馒头片上', '切成手指宽的条，可以直接抓着吃'],
    tips: ['吐司要去边，边太硬；干噎的食物旁边记得备点水'],
  },
  {
    id: 'broccoli-minced-pork',
    name: '西兰花炒肉末',
    stage: 'm12',
    category: 'meat',
    texture: '碎炒',
    tags: ['iron'],
    ingredients: ['猪肉末', '西兰花两小朵', '一点食用油'],
    steps: ['西兰花焯水后切碎', '肉末用一点油炒散炒熟', '下西兰花碎一起翻炒 1 分钟出锅'],
    tips: ['一岁后可以开始用一点点油，但仍然不加盐和酱油'],
  },
  {
    id: 'corn-rib-noodle',
    name: '玉米胡萝卜排骨汤面',
    stage: 'm12',
    category: 'staple',
    texture: '汤面',
    tags: [],
    ingredients: ['小排骨两块', '玉米、胡萝卜各一点', '宝宝面'],
    steps: ['排骨焯水后和玉米、胡萝卜一起炖到汤浓', '取汤和煮软的胡萝卜，玉米只用来提味不吃', '下面条煮软，排骨肉撕成小丝拌进去'],
    tips: ['汤本身已经有味道，不用再放盐；玉米整粒不给，容易噎'],
  },
  {
    id: 'banana-oat-pancake',
    name: '香蕉燕麦软饼',
    stage: 'm12',
    category: 'staple',
    texture: '软饼',
    tags: ['finger', 'quick'],
    ingredients: ['香蕉一根', '即食燕麦片', '鸡蛋一个'],
    steps: ['香蕉压泥，加鸡蛋和燕麦片拌匀，静置 5 分钟让燕麦吸湿', '不粘锅小火，舀一勺压成小饼', '两面定型即可，放温再给'],
    tips: ['燕麦纤维多，一次别做太多，吃多了容易胀气'],
  },
]

/** 标签 key → 展示名；未知 key 原样返回，方便以后加标记时不至于显示空白 */
export function tagLabel(key) {
  return TAG_LABELS[key] || key
}

/** 月龄档 key → 该档的中文名（找不到时返回空串） */
export function stageLabel(key) {
  const stage = STAGES.find((item) => item.key === key)
  return stage ? stage.label : ''
}

/** 分类 key → 中文名（找不到时返回空串） */
export function categoryLabel(key) {
  const category = CATEGORIES.find((item) => item.key === key)
  return category ? category.label : ''
}

/**
 * 按宝宝实际月龄挑默认档位。
 * 6 月龄以下返回空串（还没到加辅食的时候，列表就不预选任何档）。
 * @param {number} totalMonths ageParts 给出的总月龄
 */
export function stageForMonths(totalMonths) {
  const months = Number(totalMonths)
  if (!Number.isFinite(months) || months < 6) return ''
  // 从高到低找第一个够得着的档，10 个月就命中「10 月龄起」
  for (let index = STAGES.length - 1; index >= 0; index -= 1) {
    if (months >= STAGES[index].minMonths) return STAGES[index].key
  }
  return ''
}

/**
 * 筛选食谱。
 * @param {string} [stage] 月龄档 key，空串表示不限
 * @param {string} [category] 分类 key，空串表示不限
 */
export function filterRecipes(stage, category) {
  return RECIPES.filter((item) => {
    if (stage && item.stage !== stage) return false
    if (category && item.category !== category) return false
    return true
  })
}

/** 按 id 取一条，供详情页使用；找不到返回 null */
export function recipeById(id) {
  return RECIPES.find((item) => item.id === id) || null
}
