import os

# Tests never touch AWS, even on a machine where `gcorp aws up` has run.
os.environ["GCORP_AWS"] = "0"
