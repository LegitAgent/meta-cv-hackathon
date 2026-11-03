"""Pydantic request/response schemas for the Backtrack summary proxy.

UI and backend constraints must agree: 20k page text, 30k code,
5k selected text, 10k notes in aggregate. Output field lengths and
list counts are enforced here.
"""

from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

PAGE_TEXT_MAX = 20000
CODE_MAX = 30000
SELECTED_MAX = 5000
NOTES_TOTAL_MAX = 10000


class Quality(BaseModel):
    code: Literal["complete", "partial", "unavailable"]
    missingFields: list[str] = Field(default_factory=list)
    truncatedFields: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class CheckpointIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=500)
    pageText: str = Field(max_length=PAGE_TEXT_MAX)
    selectedText: str = Field(default="", max_length=SELECTED_MAX)
    code: str | None = Field(default=None, max_length=CODE_MAX)
    language: str | None = Field(default=None, max_length=64)
    quality: Quality


class NoteIn(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    body: str = Field(max_length=NOTES_TOTAL_MAX)


class SummaryRequest(BaseModel):
    requestId: str = Field(min_length=1, max_length=200)
    checkpoint: CheckpointIn
    notes: list[NoteIn] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def check_notes_total(self) -> "SummaryRequest":
        total = sum(len(n.body) for n in self.notes)
        if total > NOTES_TOTAL_MAX:
            raise ValueError(f"notes exceed {NOTES_TOTAL_MAX} characters in aggregate")
        return self


class ObservedFact(BaseModel):
    text: str = Field(min_length=1, max_length=1000)
    sourceFields: list[str] = Field(min_length=1, max_length=8)


class Summary(BaseModel):
    recap: str = Field(min_length=1, max_length=1200)
    observedFacts: list[ObservedFact] = Field(default_factory=list, max_length=20)
    possibleBlocker: str | None = Field(default=None, max_length=600)
    nextAction: str = Field(min_length=1, max_length=600)
    uncertainties: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("uncertainties")
    @classmethod
    def uncertainties_bounded(cls, v: list[str]) -> list[str]:
        for item in v:
            if len(item) > 500:
                raise ValueError("uncertainty entry too long")
        return v


class SummaryResponse(BaseModel):
    requestId: str
    checkpointId: str
    summary: Summary
    model: str


class ErrorBody(BaseModel):
    code: str
    message: str
    retryable: bool
