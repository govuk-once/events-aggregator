export interface CountryEntry {
  slug: string;
  name: string;
  supported: boolean;
}

export type ResolveResult =
  | { status: 'found'; country: CountryEntry }
  | { status: 'unknown' }
  | { status: 'unsupported' };

type CountryMapping = Record<string, CountryEntry>;

const COUNTRY_MAPPING: CountryMapping = {
  '5a292f20-a9b6-46ea-b35f-584f8b3d7392': {
    slug: 'afghanistan',
    name: 'Afghanistan',
    supported: true,
  },
  '2a3938e1-d588-45fc-8c8f-0f51814d5409': {
    slug: 'albania',
    name: 'Albania',
    supported: true,
  },
  'b5c8e64b-3461-4447-9144-1588e4a84fe6': {
    slug: 'algeria',
    name: 'Algeria',
    supported: true,
  },
  '196a0c49-e844-4246-ab7c-a5c4197dfdad': {
    slug: 'andorra',
    name: 'Andorra',
    supported: true,
  },
  '9738a4db-236d-4116-8d19-1373987b7889': {
    slug: 'angola',
    name: 'Angola',
    supported: true,
  },
  'fb061c13-3130-4338-b4c3-df3a2ab4c112': {
    slug: 'anguilla',
    name: 'Anguilla',
    supported: true,
  },
  '7a2554bd-9dc5-4a2e-953c-263c65ced66b': {
    slug: 'antarctica-british-antarctic-territory',
    name: 'Antarctica/British Antarctic Territory',
    supported: true,
  },
  '269db8e5-9fef-4840-aca4-4896c66b8329': {
    slug: 'antigua-and-barbuda',
    name: 'Antigua and Barbuda',
    supported: true,
  },
  '5393a385-63f9-466f-a851-422f249d06f8': {
    slug: 'argentina',
    name: 'Argentina',
    supported: true,
  },
  'a306037b-bed2-4607-aab6-eb5a8fa51882': {
    slug: 'armenia',
    name: 'Armenia',
    supported: true,
  },
  '56bae85b-a57c-4ca2-9dbd-68361a086bb3': {
    slug: 'aruba',
    name: 'Aruba',
    supported: true,
  },
  '48baf826-7d71-4fea-a9c4-9730fd30eb9e': {
    slug: 'australia',
    name: 'Australia',
    supported: true,
  },
  'b662d0a3-c20d-4167-8056-b9c7d058d860': {
    slug: 'austria',
    name: 'Austria',
    supported: true,
  },
  'f68b6778-cb3b-4c0b-82a0-b90613fdda26': {
    slug: 'azerbaijan',
    name: 'Azerbaijan',
    supported: true,
  },
  'ac5f0376-62ef-4f8f-8fbe-6dc6c2e4a671': {
    slug: 'bahamas',
    name: 'Bahamas',
    supported: true,
  },
  '66c3e499-0a63-42e0-833d-8b847e70e229': {
    slug: 'bahrain',
    name: 'Bahrain',
    supported: true,
  },
  '266ca3b6-752f-400b-91c0-8b9c3c433d2d': {
    slug: 'bangladesh',
    name: 'Bangladesh',
    supported: true,
  },
  'd37300da-5fca-4247-b9fc-7ae770ee992b': {
    slug: 'barbados',
    name: 'Barbados',
    supported: true,
  },
  'a73a1811-a1a0-474c-ad2c-30dc0ab74495': {
    slug: 'belarus',
    name: 'Belarus',
    supported: true,
  },
  '7631e836-3295-403d-b031-09d563322511': {
    slug: 'belgium',
    name: 'Belgium',
    supported: true,
  },
  '7e521913-0947-4c45-afc0-9ee91efd9434': {
    slug: 'belize',
    name: 'Belize',
    supported: true,
  },
  '9ce921df-748d-4efe-99b0-fc5bcd2ec045': {
    slug: 'benin',
    name: 'Benin',
    supported: true,
  },
  '186abab7-2e5c-40cd-a4f2-e3f5cfcdbde9': {
    slug: 'bermuda',
    name: 'Bermuda',
    supported: true,
  },
  'f53a97fb-4bc3-46d2-898b-d2a1e460cd0e': {
    slug: 'bhutan',
    name: 'Bhutan',
    supported: true,
  },
  '2f6708c2-9a26-4949-8eb7-824e601ee377': {
    slug: 'bolivia',
    name: 'Bolivia',
    supported: true,
  },
  'a33df5a7-34ec-4ff1-ad23-656f3d7d0331': {
    slug: 'bonaire-st-eustatius-saba',
    name: 'Bonaire/St Eustatius/Saba',
    supported: true,
  },
  '49bcb1b3-69b8-4351-84af-adb907ce3d2b': {
    slug: 'bosnia-and-herzegovina',
    name: 'Bosnia and Herzegovina',
    supported: true,
  },
  '72181a48-c553-45e4-aa5a-ebe232acea00': {
    slug: 'botswana',
    name: 'Botswana',
    supported: true,
  },
  'eaec959e-d3e2-4e69-9caa-a5fbf117c790': {
    slug: 'brazil',
    name: 'Brazil',
    supported: true,
  },
  '081268be-3cc3-4ced-9488-066532b7dea1': {
    slug: 'british-indian-ocean-territory',
    name: 'British Indian Ocean Territory',
    supported: true,
  },
  '59bfd21e-90ee-414f-acc8-696b641d4363': {
    slug: 'british-virgin-islands',
    name: 'British Virgin Islands',
    supported: true,
  },
  '65a38090-2d1c-4e45-9ebd-8638085933f1': {
    slug: 'brunei',
    name: 'Brunei',
    supported: true,
  },
  '94aa06ba-2d58-4299-88ba-8861acc18729': {
    slug: 'bulgaria',
    name: 'Bulgaria',
    supported: true,
  },
  '9ac225d7-ea48-401b-b255-7f281d2c4168': {
    slug: 'burkina-faso',
    name: 'Burkina Faso',
    supported: true,
  },
  'd13008f0-a794-47e2-a9fe-773ffe6bc0b5': {
    slug: 'burundi',
    name: 'Burundi',
    supported: true,
  },
  '8f98f704-65d6-44bc-8047-915066809df5': {
    slug: 'cambodia',
    name: 'Cambodia',
    supported: true,
  },
  '677b18e8-cec2-4d2b-b978-708d14565c94': {
    slug: 'cameroon',
    name: 'Cameroon',
    supported: true,
  },
  'f402b8de-2e99-4ff3-949f-31fe65796cae': {
    slug: 'canada',
    name: 'Canada',
    supported: true,
  },
  'a9296394-be3d-4bf2-a443-20d09a628bce': {
    slug: 'cape-verde',
    name: 'Cape Verde',
    supported: true,
  },
  '317ef779-a84c-422f-9497-ccd0bf3174ef': {
    slug: 'cayman-islands',
    name: 'Cayman Islands',
    supported: true,
  },
  'f52ed25a-1c8f-497b-938e-066d008d5d73': {
    slug: 'central-african-republic',
    name: 'Central African Republic',
    supported: true,
  },
  '5b3924c1-2907-4549-9fea-499ca43e66b4': {
    slug: 'chad',
    name: 'Chad',
    supported: true,
  },
  '09921127-6706-4893-874f-5c943b3f1c38': {
    slug: 'chile',
    name: 'Chile',
    supported: true,
  },
  'cb91b5b1-d4af-43d6-a9ea-48d56fe03300': {
    slug: 'china',
    name: 'China',
    supported: true,
  },
  '8c40f35a-ff29-4d28-93cf-90e4432de4e5': {
    slug: 'colombia',
    name: 'Colombia',
    supported: true,
  },
  '8236701c-0e96-4cfe-b315-2bd6b3e3b028': {
    slug: 'comoros',
    name: 'Comoros',
    supported: true,
  },
  '438a3cd3-5936-462d-b7ed-fff0ea485af1': {
    slug: 'congo',
    name: 'Congo',
    supported: true,
  },
  'f961f58b-3a4e-439a-b820-7ddab77e3758': {
    slug: 'cook-islands-tokelau-and-niue',
    name: 'Cook Islands, Tokelau and Niue',
    supported: true,
  },
  'f47beb28-e218-4b1a-bd4b-3c4165d056b5': {
    slug: 'costa-rica',
    name: 'Costa Rica',
    supported: true,
  },
  'f531e87f-78f5-4d67-9515-79c7cedbd5c4': {
    slug: 'croatia',
    name: 'Croatia',
    supported: true,
  },
  'd1055857-ece4-4862-9fe1-493545e9fede': {
    slug: 'cuba',
    name: 'Cuba',
    supported: true,
  },
  '60f02e47-4f6b-4873-8819-1dd913cd5df2': {
    slug: 'curacao',
    name: 'Curaçao',
    supported: true,
  },
  'd35026df-3ea6-452e-870b-71bdfb7cf73e': {
    slug: 'cyprus',
    name: 'Cyprus',
    supported: true,
  },
  'b5e5c48e-dac9-4443-a7cc-8042ccdf8404': {
    slug: 'czechia',
    name: 'Czechia',
    supported: true,
  },
  '9652542c-e5bd-4416-bbbd-5e3e19609863': {
    slug: 'cote-d-ivoire',
    name: "Côte d'Ivoire",
    supported: true,
  },
  '88122213-1a2f-420f-94f9-c622147d4300': {
    slug: 'democratic-republic-of-the-congo',
    name: 'Democratic Republic of the Congo',
    supported: true,
  },
  '8d0d439c-dcf3-4239-8049-4a7c465baad6': {
    slug: 'denmark',
    name: 'Denmark',
    supported: true,
  },
  '0b95dd6d-7234-4d04-a7a6-b412447cc2d5': {
    slug: 'djibouti',
    name: 'Djibouti',
    supported: true,
  },
  'f0615634-9fbf-46f5-8435-5ae2d23698b6': {
    slug: 'dominica',
    name: 'Dominica',
    supported: true,
  },
  '38051402-bf94-47ab-9ad7-a468280f3d9e': {
    slug: 'dominican-republic',
    name: 'Dominican Republic',
    supported: true,
  },
  'aa3bb093-06ac-4423-b242-e62ba4a4cf7d': {
    slug: 'ecuador',
    name: 'Ecuador',
    supported: true,
  },
  '52e41c89-6f2c-4db6-9370-6d41fb44fd0f': {
    slug: 'egypt',
    name: 'Egypt',
    supported: true,
  },
  '68964c7a-351f-41ae-a7f1-ecfa94263c56': {
    slug: 'el-salvador',
    name: 'El Salvador',
    supported: true,
  },
  '1907e0cd-778e-49d6-95f1-1d9b3e790c2e': {
    slug: 'equatorial-guinea',
    name: 'Equatorial Guinea',
    supported: true,
  },
  '6b47e9b9-0942-48b5-8ee1-778699ac95f0': {
    slug: 'eritrea',
    name: 'Eritrea',
    supported: true,
  },
  '16ae2d80-d6e0-4380-a358-ccd03c2bd7f7': {
    slug: 'estonia',
    name: 'Estonia',
    supported: true,
  },
  'cb0448b6-91b4-44fd-b54f-508b554971d1': {
    slug: 'eswatini',
    name: 'Eswatini',
    supported: true,
  },
  'd36e7377-4160-4e4d-a103-83980eaf9dc9': {
    slug: 'ethiopia',
    name: 'Ethiopia',
    supported: true,
  },
  '61a1542f-d196-42a0-9605-ad667b60504e': {
    slug: 'falkland-islands',
    name: 'Falkland Islands',
    supported: true,
  },
  'd010fd00-bf63-42f0-ba7b-0982f49cb3d4': {
    slug: 'federated-states-of-micronesia',
    name: 'Federated States of Micronesia',
    supported: true,
  },
  '4b79ee8f-0217-486b-bcc9-5f0ef9c16b54': {
    slug: 'fiji',
    name: 'Fiji',
    supported: true,
  },
  'f14f4107-1731-4dd8-a890-8defe459e15a': {
    slug: 'finland',
    name: 'Finland',
    supported: true,
  },
  '05a8e85c-5a65-406e-923d-79c04a4433f6': {
    slug: 'france',
    name: 'France',
    supported: true,
  },
  '020d58a7-f069-4eb8-bdf2-9979e7196ba4': {
    slug: 'french-guiana',
    name: 'French Guiana',
    supported: true,
  },
  '8dae3061-8bc3-4deb-8ac5-723957597716': {
    slug: 'french-polynesia',
    name: 'French Polynesia',
    supported: true,
  },
  'fe2044fc-4201-4116-89fd-126aaff9a987': {
    slug: 'gabon',
    name: 'Gabon',
    supported: true,
  },
  '05b21330-97be-45f0-9ddf-778c722bd116': {
    slug: 'georgia',
    name: 'Georgia',
    supported: true,
  },
  'c3d72e08-e00f-4b62-98d5-010ea1520e50': {
    slug: 'germany',
    name: 'Germany',
    supported: true,
  },
  'eca820fa-0cb2-4d26-a642-be0c041da22d': {
    slug: 'ghana',
    name: 'Ghana',
    supported: true,
  },
  '726afbd8-e8d1-4ef8-a3a8-9d0a4c467014': {
    slug: 'gibraltar',
    name: 'Gibraltar',
    supported: true,
  },
  'c5018a34-3aaa-40e4-b90f-cf73539a0978': {
    slug: 'greece',
    name: 'Greece',
    supported: true,
  },
  '674324d7-8cb1-4a4d-8480-112b0ab776c9': {
    slug: 'grenada',
    name: 'Grenada',
    supported: true,
  },
  'faad8241-f19d-4762-ba38-3b8871b5b10b': {
    slug: 'guadeloupe',
    name: 'Guadeloupe',
    supported: true,
  },
  '4c5a2c31-5e39-413b-ba7c-b87e86f8b2b4': {
    slug: 'guatemala',
    name: 'Guatemala',
    supported: true,
  },
  '1986f9ec-a8dc-4e07-8f93-cd10d65a3e10': {
    slug: 'guinea',
    name: 'Guinea',
    supported: true,
  },
  'b9f2cdf8-140e-4c97-9fcf-2e308798a294': {
    slug: 'guinea-bissau',
    name: 'Guinea-Bissau',
    supported: true,
  },
  'b2e8eed8-96d7-45e4-8c7b-20d263e6487e': {
    slug: 'guyana',
    name: 'Guyana',
    supported: true,
  },
  'a6d54a9d-12f7-49e4-84bc-3b5167489ce5': {
    slug: 'haiti',
    name: 'Haiti',
    supported: true,
  },
  '80d80224-d917-4d7a-881e-1122fe1e7799': {
    slug: 'honduras',
    name: 'Honduras',
    supported: true,
  },
  '78fe3dfe-d561-434d-9db6-970c70597b3d': {
    slug: 'hong-kong',
    name: 'Hong Kong',
    supported: true,
  },
  '715dc6fa-15fe-40fc-a4ba-f5274142d921': {
    slug: 'hungary',
    name: 'Hungary',
    supported: true,
  },
  '0e0f3be9-5805-43c5-9535-b42a88219ea6': {
    slug: 'iceland',
    name: 'Iceland',
    supported: true,
  },
  'ea7e300b-24dd-40af-afde-fd690a2df678': {
    slug: 'india',
    name: 'India',
    supported: true,
  },
  'e2c44bf1-0b96-4034-9ac8-96f6e0181a80': {
    slug: 'indonesia',
    name: 'Indonesia',
    supported: true,
  },
  '05bc5265-c585-4b5c-b813-c8f245ddfc7f': {
    slug: 'iran',
    name: 'Iran',
    supported: true,
  },
  'bba7f111-b07f-461d-9bab-8a7366aabd40': {
    slug: 'iraq',
    name: 'Iraq',
    supported: true,
  },
  '9affaaf6-e7b5-416d-b806-d8e7c0cb0cbf': {
    slug: 'ireland',
    name: 'Ireland',
    supported: true,
  },
  '250a060b-d764-4e0c-b131-dc2d10c3160e': {
    slug: 'israel',
    name: 'Israel',
    supported: true,
  },
  '00a2d263-f4cc-4ed1-9ae8-ce5e73ce4d30': {
    slug: 'italy',
    name: 'Italy',
    supported: true,
  },
  '1def455a-6ee1-4235-b109-3b485a208b84': {
    slug: 'jamaica',
    name: 'Jamaica',
    supported: true,
  },
  '8a8de3c7-0b94-4670-87a7-f110d789d3d3': {
    slug: 'japan',
    name: 'Japan',
    supported: true,
  },
  'a03f9a35-51a9-47a8-95b5-2e4bcdaa5dd8': {
    slug: 'jordan',
    name: 'Jordan',
    supported: true,
  },
  '172402e4-e1c9-4739-bae5-80bf1d1005c3': {
    slug: 'kazakhstan',
    name: 'Kazakhstan',
    supported: true,
  },
  '47d7619a-8621-49bc-8e67-75e06b3fb610': {
    slug: 'kenya',
    name: 'Kenya',
    supported: true,
  },
  'd68b6113-2270-41a2-85cc-97b494d65cb6': {
    slug: 'kiribati',
    name: 'Kiribati',
    supported: true,
  },
  '261a33bd-bf2f-401e-b5e1-31d0b085f4ae': {
    slug: 'kosovo',
    name: 'Kosovo',
    supported: true,
  },
  'bb97fe15-ec47-4968-a2e8-1922e5916cb4': {
    slug: 'kuwait',
    name: 'Kuwait',
    supported: true,
  },
  '6cd1bdd0-0afc-492f-bae9-6cc219213b87': {
    slug: 'kyrgyzstan',
    name: 'Kyrgyzstan',
    supported: true,
  },
  '602e34bf-8222-4391-96d9-548dbe1e1799': {
    slug: 'laos',
    name: 'Laos',
    supported: true,
  },
  'ba3b46db-c2eb-404d-bcdd-63ccd956cebc': {
    slug: 'latvia',
    name: 'Latvia',
    supported: true,
  },
  'd1ee9570-46b5-421f-a36c-68b5f30b9742': {
    slug: 'lebanon',
    name: 'Lebanon',
    supported: true,
  },
  '1bda9310-85a5-491b-8d33-fc494daeb83e': {
    slug: 'lesotho',
    name: 'Lesotho',
    supported: true,
  },
  '2bb95e1c-fdf2-4210-8047-210d5c0d6044': {
    slug: 'liberia',
    name: 'Liberia',
    supported: true,
  },
  '83ed7690-9249-41c3-8525-12a15e46f6ba': {
    slug: 'libya',
    name: 'Libya',
    supported: true,
  },
  'c8a0bcf9-ddf9-4906-9457-cd179d70ed57': {
    slug: 'liechtenstein',
    name: 'Liechtenstein',
    supported: true,
  },
  'b6321337-80c2-4f1b-910a-aad4852dc7d7': {
    slug: 'lithuania',
    name: 'Lithuania',
    supported: true,
  },
  'bfff46a6-c3d8-4881-af8e-e62af3f5a03a': {
    slug: 'luxembourg',
    name: 'Luxembourg',
    supported: true,
  },
  'c442b539-cc27-4637-af33-c5d51e0727a8': {
    slug: 'macao',
    name: 'Macao',
    supported: true,
  },
  'ee0ba11b-98de-4dd5-b66a-b54dfe55cde6': {
    slug: 'madagascar',
    name: 'Madagascar',
    supported: true,
  },
  '5911a0b5-1d96-49c5-9e83-3ed20a815995': {
    slug: 'malawi',
    name: 'Malawi',
    supported: true,
  },
  '126d47f7-5fd2-41ff-af17-b23564355e03': {
    slug: 'malaysia',
    name: 'Malaysia',
    supported: true,
  },
  '99e0a892-9daa-443c-b96c-97ba9e28a2c8': {
    slug: 'maldives',
    name: 'Maldives',
    supported: true,
  },
  '19793ecb-fdaf-4b00-a3b8-bab6805c5205': {
    slug: 'mali',
    name: 'Mali',
    supported: true,
  },
  '0b04ef72-ed4f-427c-82fb-851004d9a4d9': {
    slug: 'malta',
    name: 'Malta',
    supported: true,
  },
  'd8aaa1cd-85d2-4ba6-a825-b13319efa4d8': {
    slug: 'marshall-islands',
    name: 'Marshall Islands',
    supported: true,
  },
  '21c92da9-777e-4dcd-a6fc-dc73b6bb0099': {
    slug: 'martinique',
    name: 'Martinique',
    supported: true,
  },
  '15469fdc-d0d1-4a9f-a59e-b3d3acdea226': {
    slug: 'mauritania',
    name: 'Mauritania',
    supported: true,
  },
  '51cc8ddf-0dc6-453a-b721-940068671aff': {
    slug: 'mauritius',
    name: 'Mauritius',
    supported: true,
  },
  '61c6b7aa-a4d1-43a6-8f69-99dd9596ab2d': {
    slug: 'mayotte',
    name: 'Mayotte',
    supported: true,
  },
  '34dafa2b-24e5-4625-b542-bf5e0bb8cd80': {
    slug: 'mexico',
    name: 'Mexico',
    supported: true,
  },
  '4064154c-ef7e-4edf-9f98-8f747ce39471': {
    slug: 'moldova',
    name: 'Moldova',
    supported: true,
  },
  '09c1d197-d95b-44ea-bc64-489b126c2246': {
    slug: 'monaco',
    name: 'Monaco',
    supported: true,
  },
  'c5501de2-f581-450d-bdb9-0cfda75b7502': {
    slug: 'mongolia',
    name: 'Mongolia',
    supported: true,
  },
  'ec6dceb9-de27-496d-be5d-da7f1dfc25bb': {
    slug: 'montenegro',
    name: 'Montenegro',
    supported: true,
  },
  '03a790cd-d685-4569-a1c6-bf4157f4777d': {
    slug: 'montserrat',
    name: 'Montserrat',
    supported: true,
  },
  '7584a0dd-accf-4901-a8a6-bc964dc1412f': {
    slug: 'morocco',
    name: 'Morocco',
    supported: true,
  },
  'eb77a950-bd40-4a8d-8f3b-1f92d126930d': {
    slug: 'mozambique',
    name: 'Mozambique',
    supported: true,
  },
  'ed343e59-83ca-496b-84b1-8f85c71a747d': {
    slug: 'myanmar',
    name: 'Myanmar (Burma)',
    supported: true,
  },
  '5a2d153e-efc6-4dbc-b3ac-d81e51e4f1f7': {
    slug: 'namibia',
    name: 'Namibia',
    supported: true,
  },
  '6f2af041-91cb-408a-8377-1b41c9d59f23': {
    slug: 'nauru',
    name: 'Nauru',
    supported: true,
  },
  'd2ac8d41-054a-4a47-a8f5-9f9a5bb37ad9': {
    slug: 'nepal',
    name: 'Nepal',
    supported: true,
  },
  '98641f11-0391-4679-a033-6d79db918d05': {
    slug: 'netherlands',
    name: 'Netherlands',
    supported: true,
  },
  'a6b88bf7-e78f-4c0e-9de6-e291ee8a5305': {
    slug: 'new-caledonia',
    name: 'New Caledonia',
    supported: true,
  },
  '9221e19e-95ea-4045-bafa-1b22671e227c': {
    slug: 'new-zealand',
    name: 'New Zealand',
    supported: true,
  },
  '864d9605-b3f8-4ed4-a846-0cf948cfea44': {
    slug: 'nicaragua',
    name: 'Nicaragua',
    supported: true,
  },
  '06c5b994-2e2e-41d8-bf14-75885e3887fb': {
    slug: 'niger',
    name: 'Niger',
    supported: true,
  },
  '7ba86fb6-c102-4d5f-bdcd-39f7702ae0cc': {
    slug: 'nigeria',
    name: 'Nigeria',
    supported: true,
  },
  '277fdb72-8046-490f-8076-b3203e20c467': {
    slug: 'north-korea',
    name: 'North Korea',
    supported: true,
  },
  '269306a3-45ab-4d96-a004-9abfcb7f7972': {
    slug: 'north-macedonia',
    name: 'North Macedonia',
    supported: true,
  },
  '5db38510-b08a-4e4c-b84f-ca2d62353ab6': {
    slug: 'norway',
    name: 'Norway',
    supported: true,
  },
  'aa62bc84-6fd0-4665-8b9a-4c4ab5977e8a': {
    slug: 'oman',
    name: 'Oman',
    supported: true,
  },
  'ea339677-8843-4a8a-b5ad-dff327d70ce3': {
    slug: 'pakistan',
    name: 'Pakistan',
    supported: true,
  },
  'fb9351aa-1fc4-4df1-8d9f-504a89ea5856': {
    slug: 'palau',
    name: 'Palau',
    supported: true,
  },
  '1db59f95-ea74-4cb0-b5c3-9b0724001e17': {
    slug: 'palestine',
    name: 'Palestine',
    supported: true,
  },
  'a15edf3a-5af1-45b3-8a10-31fcf4bfdbea': {
    slug: 'panama',
    name: 'Panama',
    supported: true,
  },
  'a55aacc4-9c01-4257-8a72-4cd5c972dceb': {
    slug: 'papua-new-guinea',
    name: 'Papua New Guinea',
    supported: true,
  },
  '4a24839c-226b-4f19-8026-c88c4fca3988': {
    slug: 'paraguay',
    name: 'Paraguay',
    supported: true,
  },
  'a1c8c919-6d66-41cf-ba90-5f51a0b0eb3f': {
    slug: 'peru',
    name: 'Peru',
    supported: true,
  },
  '9a7fcd1d-1be5-4342-89ff-a4bd8ecf93e3': {
    slug: 'philippines',
    name: 'Philippines',
    supported: true,
  },
  'c925efa1-bbda-455a-b45b-7109ab384247': {
    slug: 'pitcairn-island',
    name: 'Pitcairn Island',
    supported: true,
  },
  '5931cad1-dc75-4c21-b84e-c176441e0190': {
    slug: 'poland',
    name: 'Poland',
    supported: true,
  },
  '84647e7e-66d3-4b91-b562-b2a65c3c0be6': {
    slug: 'portugal',
    name: 'Portugal',
    supported: true,
  },
  '3d94082a-6e41-4c09-ba52-1b282943caae': {
    slug: 'qatar',
    name: 'Qatar',
    supported: true,
  },
  'ddf42429-0853-4737-b75d-2aeaf16b30a0': {
    slug: 'romania',
    name: 'Romania',
    supported: true,
  },
  '821537bc-8189-4347-b04d-3c3029f8c947': {
    slug: 'russia',
    name: 'Russia',
    supported: true,
  },
  '25d2eeab-5494-4fe7-b558-b478c873923d': {
    slug: 'rwanda',
    name: 'Rwanda',
    supported: true,
  },
  '150b2c9a-8958-43a8-a9e8-a24045071289': {
    slug: 'reunion',
    name: 'Réunion',
    supported: true,
  },
  'c3c1f5ef-9041-46ab-a8e2-400d183e8c59': {
    slug: 'samoa',
    name: 'Samoa',
    supported: true,
  },
  'b2967d73-df09-43db-bc64-9d90e468c6b5': {
    slug: 'san-marino',
    name: 'San Marino',
    supported: true,
  },
  'a83fb6ba-7c3c-4e32-afe0-d7dce1ea5e6b': {
    slug: 'saudi-arabia',
    name: 'Saudi Arabia',
    supported: true,
  },
  '4ac15add-d794-4b65-9dfe-3488dcc04fa1': {
    slug: 'senegal',
    name: 'Senegal',
    supported: true,
  },
  'e21957c3-680e-4b4a-bc04-589abc3a2b60': {
    slug: 'serbia',
    name: 'Serbia',
    supported: true,
  },
  '969f0558-e381-4a34-a8a5-91d106d89050': {
    slug: 'seychelles',
    name: 'Seychelles',
    supported: true,
  },
  'b53b8c14-ae32-46ed-af66-04a6eb350c7a': {
    slug: 'sierra-leone',
    name: 'Sierra Leone',
    supported: true,
  },
  '06ffd544-1097-41b1-90b6-b9a74f78669e': {
    slug: 'singapore',
    name: 'Singapore',
    supported: true,
  },
  '9ae32c04-25b7-4627-8ddc-5d5dc7746825': {
    slug: 'slovakia',
    name: 'Slovakia',
    supported: true,
  },
  'e380b607-2886-4103-90b8-a044af29772e': {
    slug: 'slovenia',
    name: 'Slovenia',
    supported: true,
  },
  '44e13401-96f0-4ac1-bfdd-9f0cc0111b40': {
    slug: 'solomon-islands',
    name: 'Solomon Islands',
    supported: true,
  },
  '992befc4-32a3-4a1a-a034-c9cb2ff42bad': {
    slug: 'somalia',
    name: 'Somalia',
    supported: true,
  },
  'e4649806-d58a-40f7-b86d-09a4376c25a0': {
    slug: 'south-africa',
    name: 'South Africa',
    supported: true,
  },
  '4b0ade17-81e9-4ab2-af5c-c33df84fc0dd': {
    slug: 'south-georgia-and-south-sandwich-islands',
    name: 'South Georgia and the South Sandwich Islands',
    supported: true,
  },
  '78f22c79-1f19-4ce2-ab69-2a221c770e52': {
    slug: 'south-korea',
    name: 'South Korea',
    supported: true,
  },
  '86224eb2-3686-4558-8405-491d544be4db': {
    slug: 'south-sudan',
    name: 'South Sudan',
    supported: true,
  },
  '24df0bb1-0ca1-4675-9237-528ecd3d17a5': {
    slug: 'spain',
    name: 'Spain',
    supported: true,
  },
  'c90dd329-ea2a-413a-b927-a67bd3cbbb84': {
    slug: 'sri-lanka',
    name: 'Sri Lanka',
    supported: true,
  },
  'ab5bb8cb-92d9-440d-90dc-889d301675af': {
    slug: 'st-helena-ascension-and-tristan-da-cunha',
    name: 'St Helena, Ascension and Tristan da Cunha',
    supported: true,
  },
  'e07d2af5-f1a8-47e9-b4ff-33d7ff1178ef': {
    slug: 'st-kitts-and-nevis',
    name: 'St Kitts and Nevis',
    supported: true,
  },
  '5a9e154c-e1dc-4fde-8182-58c5b6e69efa': {
    slug: 'st-lucia',
    name: 'St Lucia',
    supported: true,
  },
  'f752255c-de89-4b61-af7a-6233dd44a58a': {
    slug: 'st-maarten',
    name: 'St Maarten',
    supported: true,
  },
  '98c0a9e6-54b0-4c67-8007-43bde256e8ad': {
    slug: 'st-martin-and-st-barthelemy',
    name: 'St Martin and St Barthélemy',
    supported: true,
  },
  '31b8bebb-c8a6-4634-acd7-4e073e23826b': {
    slug: 'st-pierre-and-miquelon',
    name: 'St Pierre & Miquelon',
    supported: true,
  },
  'c04c4008-678c-43c0-b4f6-bd542f77fda8': {
    slug: 'st-vincent-and-the-grenadines',
    name: 'St Vincent and the Grenadines',
    supported: true,
  },
  'deee5c29-5006-4280-bb46-44c0bd7a6a11': {
    slug: 'sudan',
    name: 'Sudan',
    supported: true,
  },
  '0e50ddd6-ee02-4d1c-815b-7f35a8777f72': {
    slug: 'suriname',
    name: 'Suriname',
    supported: true,
  },
  '9772ac3f-b0ea-4787-b859-9a091e1f8af6': {
    slug: 'sweden',
    name: 'Sweden',
    supported: true,
  },
  '3985ac9b-d0c0-423b-9936-94a3ac3bed62': {
    slug: 'switzerland',
    name: 'Switzerland',
    supported: true,
  },
  '85c16f75-3380-497e-a915-4d77256cde37': {
    slug: 'syria',
    name: 'Syria',
    supported: true,
  },
  'a3605d0c-bf86-41f9-9f50-7bd577052c4c': {
    slug: 'sao-tome-and-principe',
    name: 'São Tomé and Principe',
    supported: true,
  },
  'b486e8b6-fbe2-443d-acaa-cc0c5a8b4cfe': {
    slug: 'taiwan',
    name: 'Taiwan',
    supported: true,
  },
  '1a06c5d2-9457-477a-a3ea-1ce3b8b44fc1': {
    slug: 'tajikistan',
    name: 'Tajikistan',
    supported: true,
  },
  '203432b1-e296-4ffe-9fc9-dcfe110c0d67': {
    slug: 'tanzania',
    name: 'Tanzania',
    supported: true,
  },
  '724a37c1-2f81-40b2-8640-d3d06e74d2bb': {
    slug: 'thailand',
    name: 'Thailand',
    supported: true,
  },
  '35007dbc-65c9-418b-9ce8-3d28832eb8ee': {
    slug: 'the-gambia',
    name: 'The Gambia',
    supported: true,
  },
  '0b059300-5933-4123-a27a-af603904c8be': {
    slug: 'timor-leste',
    name: 'Timor-Leste',
    supported: true,
  },
  '68ee5e60-28d7-40ae-90eb-3d917ece53de': {
    slug: 'togo',
    name: 'Togo',
    supported: true,
  },
  '96f71287-395b-435b-94ef-855b0f14e2c6': {
    slug: 'tonga',
    name: 'Tonga',
    supported: true,
  },
  '2cacdc4c-913b-463a-b29e-4a5f45b67e4e': {
    slug: 'trinidad-and-tobago',
    name: 'Trinidad and Tobago',
    supported: true,
  },
  '29351cb7-7523-4ab7-8adf-8d2e2c8768b1': {
    slug: 'tunisia',
    name: 'Tunisia',
    supported: true,
  },
  '385d62b6-1fb3-4b29-80f3-cef2efa73cce': {
    slug: 'turkey',
    name: 'Turkey',
    supported: true,
  },
  'ac173bb7-97ce-4dc3-b8a9-dae920d595db': {
    slug: 'turkmenistan',
    name: 'Turkmenistan',
    supported: true,
  },
  'f931c121-e8be-4b50-ab51-762e9741834e': {
    slug: 'turks-and-caicos-islands',
    name: 'Turks and Caicos Islands',
    supported: true,
  },
  'b60c33a7-0d98-4d98-a79d-fe48735a2116': {
    slug: 'tuvalu',
    name: 'Tuvalu',
    supported: true,
  },
  'f2cecaae-77ce-4df3-bf27-7783c3975706': {
    slug: 'usa',
    name: 'USA',
    supported: true,
  },
  '77488676-da3d-4752-a6b2-f99c7691bf67': {
    slug: 'uganda',
    name: 'Uganda',
    supported: true,
  },
  'ed654721-0bf5-415e-ad51-4fe93e6b3a0b': {
    slug: 'ukraine',
    name: 'Ukraine',
    supported: true,
  },
  '753268f3-f9fb-44bb-bcb2-84a570ea637e': {
    slug: 'united-arab-emirates',
    name: 'United Arab Emirates',
    supported: true,
  },
  '67ab9201-cd93-4ebe-bc2b-085f540705f7': {
    slug: 'uruguay',
    name: 'Uruguay',
    supported: true,
  },
  '2f79a772-583b-4f01-adc1-5dc832eddcec': {
    slug: 'uzbekistan',
    name: 'Uzbekistan',
    supported: true,
  },
  '89ce38b7-40fa-46e6-9073-235ac6923425': {
    slug: 'vanuatu',
    name: 'Vanuatu',
    supported: true,
  },
  'ca3a5c2c-1c6a-483d-88a1-5feb813ba4f3': {
    slug: 'venezuela',
    name: 'Venezuela',
    supported: true,
  },
  '8f6e7323-3d10-46da-a1a7-c50b5fc5a5ea': {
    slug: 'vietnam',
    name: 'Vietnam',
    supported: true,
  },
  '714e5775-6655-449e-ac16-2897f8a14f73': {
    slug: 'wallis-and-futuna',
    name: 'Wallis and Futuna',
    supported: true,
  },
  '18d6ade3-900d-44ab-b251-ee5f791ba4b4': {
    slug: 'western-sahara',
    name: 'Western Sahara',
    supported: true,
  },
  '73891fe3-3a92-4c2e-a1a6-b63f00186ce8': {
    slug: 'yemen',
    name: 'Yemen',
    supported: true,
  },
  '7e2beff5-a1ee-4ed4-ad63-c9a72bb0dc17': {
    slug: 'zambia',
    name: 'Zambia',
    supported: true,
  },
  'd38db404-4291-4088-951a-1b8d5b696f1e': {
    slug: 'zimbabwe',
    name: 'Zimbabwe',
    supported: true,
  },
};

export function resolveCountry(contentId: string): ResolveResult {
  const entry = COUNTRY_MAPPING[contentId];
  if (!entry) return { status: 'unknown' };
  if (!entry.supported) return { status: 'unsupported' };
  return { status: 'found', country: entry };
}
