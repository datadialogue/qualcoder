/**
 * Starting codebook, taken from section 6.1 of the paper (thematic analysis of
 * participants' retrospective reflections).
 *
 * The first three themes and their seven codes are the ones the paper describes.
 * Note that the paper's own text says "6 sub themes" but goes on to describe
 * seven; all seven are included here.
 *
 * The fourth theme is marked `fromObservations` because it comes from the
 * paragraph of additional observations at the end of 6.1.3 rather than from the
 * formal codebook. Delete it if you would rather not code for those.
 */

export interface SeedCode {
  name: string;
  definition: string;
  inclusion?: string;
  exclusion?: string;
  example?: string;
  color: string;
}

export interface SeedTheme {
  name: string;
  description: string;
  color: string;
  fromObservations?: boolean;
  codes: SeedCode[];
}

export const PAPER_CODEBOOK: SeedTheme[] = [
  {
    name: "Type of offensiveness",
    description:
      "What in the content itself the participant pointed to as grounds for their decision.",
    color: "#94472f",
    codes: [
      {
        name: "No offensive content",
        definition: "States that the messages reviewed contained nothing offensive.",
        inclusion:
          "The participant characterises what they read as harmless, friendly, or inoffensive.",
        exclusion:
          "Not for cases where offensive content is acknowledged and then discounted — use One-off offensive, or a code under Justifications.",
        example: "All the messages I viewed were friendly, therefore I decided not to suspend.",
        color: "#7a8c6b",
      },
      {
        name: "Threats of violence",
        definition:
          "Points to an explicit threat to harm or kill someone as grounds for the decision.",
        inclusion:
          "Direct threats, wishing serious harm on someone, or references to violence in real life.",
        exclusion:
          "If the threat is named and then dismissed as venting or a joke, apply Appeal to intent as well.",
        example: "The first message was a clear threat to kill someone.",
        color: "#a8342a",
      },
      {
        name: "Hate speech and offensive language",
        definition:
          "Points to slurs, derogatory language, hate speech, or targeted personal attacks.",
        inclusion:
          "Slurs and identity-based attacks (homophobic, racist, sexist), personal attacks on appearance, insults aimed at someone's family.",
        example: "Using slurs against LGBTQ individuals shouldn't be tolerated.",
        color: "#b5623a",
      },
    ],
  },
  {
    name: "Patterns of behavior",
    description:
      "Reasoning about how often offensive messages occurred across the account, rather than about any single message.",
    color: "#3b5f9e",
    codes: [
      {
        name: "Consistent offensive behavior",
        definition: "Points to a repeated pattern of offensive messages across the account.",
        inclusion:
          "Counts or proportions of offensive messages, or characterisations such as 'numerous' or 'every comment'.",
        example: "Four out of five comments were offensive enough to suspend.",
        color: "#3b5f9e",
      },
      {
        name: "One-off offensive",
        definition:
          "Treats offensive content as isolated, and therefore as insufficient grounds for suspension.",
        inclusion:
          "Acknowledges an offensive message while stressing that the remaining messages were fine.",
        exclusion:
          "Not for accounts the participant describes as having no offensive content at all — use No offensive content.",
        example: "Only one message was offensive among the rest, so no suspension.",
        color: "#5b86c9",
      },
    ],
  },
  {
    name: "Justifications",
    description:
      "Grounds given for discounting offensive content the participant has already recognised.",
    color: "#2f6f5e",
    codes: [
      {
        name: "Contextual understanding",
        definition:
          "Appeals to context: that the content was misread, that it was normal for the setting, or that more context would be needed to judge.",
        inclusion:
          "Reading content as banter, treating the situation as not serious enough, or saying the intent cannot be judged without more context.",
        example: "Although a comment seemed offensive, it was part of normal banter.",
        color: "#2f6f5e",
      },
      {
        name: "Appeal to intent",
        definition:
          "Interprets the poster's intent or state of mind — humour, venting, a difficult period, or the capacity to change.",
        inclusion:
          "Attributing the message to a mood or motive rather than to character, or extending the benefit of the doubt.",
        example: "The user's intention seems more humorous than harmful.",
        color: "#4f9b7f",
      },
    ],
  },
  {
    name: "Reflection on the decision",
    description:
      "From the observations at the end of section 6.1.3, which the paper reports as falling outside the seven sub-themes. Delete this theme if you would rather not code for these.",
    color: "#5a4a8c",
    fromObservations: true,
    codes: [
      {
        name: "Expressed uncertainty",
        definition: "Reports a lack of confidence in the decision that was just made.",
        example: "I wasn't 100 percent confident on my decision.",
        color: "#5a4a8c",
      },
      {
        name: "Would revise the decision",
        definition: "On reflection, says they would now decide differently.",
        example: "Looking back now, I think I should've suspended this account.",
        color: "#7d6bb0",
      },
      {
        name: "References the recommendation",
        definition:
          "Mentions the AI or crowd label as a reason for the decision. The paper reports finding no such mentions; the code exists so that absence can be demonstrated rather than assumed.",
        inclusion: "Any reference to what the AI said, or to what other people thought.",
        example: "(the paper reports no instances of this in the data)",
        color: "#8a7fc4",
      },
    ],
  },
];
