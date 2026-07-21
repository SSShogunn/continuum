import instructor
import litellm
from instructor.core.exceptions import InstructorRetryException

# Not every provider supports every param we pass (e.g. reasoning_effort isn't
# valid for all Gemini models) — since the model is meant to be swappable via
# env var, silently drop unsupported params per-provider rather than hard-fail.
litellm.drop_params = True

client = instructor.from_litellm(litellm.acompletion)

_TRANSIENT_EXCEPTIONS = (
    litellm.exceptions.RateLimitError,
    litellm.exceptions.APIConnectionError,
    litellm.exceptions.Timeout,
)


def is_transient_failure(exc: BaseException) -> bool:
    # instructor wraps the underlying cause in InstructorRetryException once its
    # own retries are exhausted — the raw litellm exception types never reach this
    # point directly, so we have to unwrap it. Where the underlying cause actually
    # ends up differs by failure mode (confirmed by direct testing, not assumed):
    # transport-level errors (e.g. connection failures) show up via Python's
    # exception-chaining `__cause__`, with `failed_attempts` left empty, while
    # validation failures populate `failed_attempts` instead. Check both.
    if not isinstance(exc, InstructorRetryException):
        return False
    if isinstance(exc.__cause__, _TRANSIENT_EXCEPTIONS):
        return True
    return bool(exc.failed_attempts) and isinstance(exc.failed_attempts[-1].exception, _TRANSIENT_EXCEPTIONS)
